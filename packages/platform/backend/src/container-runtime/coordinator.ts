import type {
  DatabaseManager,
  RuntimeAction,
  RuntimeWorkload,
  RuntimeWorkloadKind,
} from "../database"
import type {
  AgentCommand,
  AgentConnection,
  AgentConnectionRegistry,
  AgentEvent,
  AgentTransport,
} from "./agent-registry"
import type { RuntimeAdapterProvider, RuntimeOwnership, WorkloadIntent } from "./contracts"
import type { RuntimeCredentialSigner, RuntimePermission } from "./credentials"
import { randomUUID } from "node:crypto"
import { RuntimeBuildTasks } from "./build-tasks"
import { abortable } from "./contracts"

export type RuntimeDomainContext = {
  workload: RuntimeWorkload
  action?: RuntimeAction
  connection: AgentConnection
}
export interface RuntimeDomainHandler {
  /** Resolves only once any domain writes or streamed output have been durably accepted. */
  event(context: RuntimeDomainContext, event: AgentEvent): Promise<unknown>
  interrupted?(action: RuntimeAction, reason: string): Promise<void>
}
export type CreateRuntimeWorkload = {
  projectId: string
  kind: RuntimeWorkloadKind
  ownerId: string
}
export type CreateRuntimeAction = {
  workloadId: string
  kind: "pulumi" | "composite_evaluation"
  ownerId: string
  snapshotId?: string
  imageDigest?: string
}
const activeActions = ["pending", "running", "cancelling"] as const

export class RuntimeCoordinator {
  private readonly placements = new RuntimeBuildTasks()
  private readonly pendingDispatch = new Map<string, AbortController>()
  private readonly results = new Map<
    string,
    {
      resolve: (value: AgentEvent) => void
      reject: (reason: unknown) => void
      promise: Promise<AgentEvent>
    }
  >()
  private readonly handlers = new Map<RuntimeWorkloadKind, RuntimeDomainHandler>()
  private readonly serial = new Map<string, Promise<unknown>>()
  private readonly requests = new Map<
    string,
    {
      connection: AgentConnection
      actionId?: string
      resolve: (event: AgentEvent) => void
      reject: (error: unknown) => void
    }
  >()
  private readonly eventCounts = new Map<string, number>()

  constructor(
    private readonly database: DatabaseManager,
    private readonly adapters: RuntimeAdapterProvider,
    private readonly signer: RuntimeCredentialSigner,
    readonly connections: AgentConnectionRegistry,
    private readonly backendId: string,
    private readonly leaseMs = 30_000,
    private readonly now: () => number = Date.now,
    private readonly startupLeaseMs = 300_000,
  ) {}

  get leaseDurationMs(): number {
    return this.leaseMs
  }

  registerHandler(kind: RuntimeWorkloadKind, handler: RuntimeDomainHandler): void {
    this.handlers.set(kind, handler)
  }

  private async exclusive<T>(workloadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.serial.get(workloadId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    this.serial.set(workloadId, next)
    try {
      return await next
    } finally {
      if (this.serial.get(workloadId) === next) this.serial.delete(workloadId)
    }
  }

  ownership(workload: RuntimeWorkload): RuntimeOwnership {
    return {
      backendId: this.backendId,
      projectId: workload.projectId,
      runtimeId: workload.runtimeId,
      workloadId: workload.id,
      kind: workload.kind,
      generation: workload.leaseGeneration,
      operationId: workload.kind === "pulumi" ? workload.ownerId : undefined,
    }
  }

  async createWorkload(input: CreateRuntimeWorkload): Promise<RuntimeWorkload> {
    return await this.database.backend.$transaction(async tx => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId } })
      if (!project.containerRuntimeId) throw new Error("Project has no selected container runtime")
      return await tx.runtimeWorkload.create({
        data: {
          ...input,
          runtimeId: project.containerRuntimeId,
          leaseExpiresAt: new Date(this.now() + this.startupLeaseMs),
        },
      })
    })
  }

  async place(
    workloadId: string,
    intent: Omit<WorkloadIntent, "owner">,
    signal?: AbortSignal,
  ): Promise<RuntimeWorkload> {
    return await this.placements.run(
      workloadId,
      async signal => await this.placeWorkload(workloadId, intent, signal),
      signal,
    )
  }

  private async placeWorkload(
    workloadId: string,
    intent: Omit<WorkloadIntent, "owner">,
    signal: AbortSignal,
  ): Promise<RuntimeWorkload> {
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: workloadId },
    })
    if (workload.desiredState !== "running" || workload.cleanedUpAt)
      throw new Error("Workload is no longer desired")
    await this.database.backend.runtimeWorkload.update({
      where: { id: workloadId },
      data: { status: "starting" },
    })
    const adapter = await this.adapters.get(workload.runtimeId)
    const renewal = setInterval(
      () => {
        void this.database.backend.runtimeWorkload
          .updateMany({
            where: {
              id: workloadId,
              leaseGeneration: workload.leaseGeneration,
              desiredState: "running",
              status: "starting",
            },
            data: { leaseExpiresAt: new Date(this.now() + this.startupLeaseMs) },
          })
          .catch(() => {})
      },
      Math.max(1000, Math.floor(this.leaseMs / 3)),
    )
    renewal.unref()
    try {
      const owner = this.ownership(workload)
      const native = await adapter.place(
        {
          ...intent,
          owner: {
            ...owner,
            operationId: intent.environment?.owner.operationId ?? owner.operationId,
          },
        },
        signal,
      )
      const update = await this.database.backend.runtimeWorkload.updateMany({
        where: {
          id: workloadId,
          leaseGeneration: workload.leaseGeneration,
          desiredState: "running",
        },
        data: {
          nativeResourceId: native.id,
          status:
            native.state === "pending"
              ? "starting"
              : native.state === "missing"
                ? "lost"
                : native.state,
        },
      })
      if (!update.count) throw new Error("Workload placement superseded")
      return await this.database.backend.runtimeWorkload.findUniqueOrThrow({
        where: { id: workloadId },
      })
    } catch (error) {
      await this.database.backend.runtimeWorkload.updateMany({
        where: { id: workloadId, leaseGeneration: workload.leaseGeneration },
        data: { status: "failed", lastError: String(error), desiredState: "deleted" },
      })
      throw error
    } finally {
      clearInterval(renewal)
    }
  }

  async authorize(
    workloadId: string,
    permissions: RuntimePermission[],
    ttlMs = 900_000,
  ): Promise<{ token: string; scope: RuntimeOwnership; expiresAt: Date }> {
    return await this.exclusive(workloadId, () =>
      this.authorizeLease(workloadId, permissions, ttlMs),
    )
  }

  private async authorizeLease(
    workloadId: string,
    permissions: RuntimePermission[],
    ttlMs: number,
  ) {
    if (ttlMs <= 0 || ttlMs > 900_000) throw new Error("Invalid runtime credential lifetime")
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: workloadId },
    })
    if (workload.desiredState !== "running" || workload.cleanedUpAt)
      throw new Error("Cannot authorize inactive workload")
    const expiresAt = new Date(this.now() + ttlMs)
    const update = await this.database.backend.runtimeWorkload.updateMany({
      where: { id: workloadId, leaseGeneration: workload.leaseGeneration, desiredState: "running" },
      data: {
        leaseGeneration: { increment: 1 },
        connectedAt: null,
        leaseExpiresAt: new Date(this.now() + this.startupLeaseMs),
      },
    })
    if (!update.count) throw new Error("Workload lease changed concurrently")
    this.connections.invalidate(workloadId, new Error("Runtime lease generation replaced"))
    await this.interrupt(workload, "Runtime lease generation replaced")
    if (workload.nativeResourceId) {
      await (await this.adapters.get(workload.runtimeId)).stop(workload.nativeResourceId, true)
      await this.database.backend.runtimeWorkload.updateMany({
        where: { id: workloadId, leaseGeneration: workload.leaseGeneration + 1 },
        data: { nativeResourceId: null, status: "pending" },
      })
    }
    const scope = this.ownership({ ...workload, leaseGeneration: workload.leaseGeneration + 1 })
    return { token: this.signer.issue(scope, permissions, expiresAt.getTime()), scope, expiresAt }
  }

  async authenticate(connection: AgentConnection): Promise<RuntimeWorkload> {
    this.connections.assertCurrent(connection)
    const scope = connection.scope
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: scope.workloadId },
    })
    if (
      scope.expiresAt <= this.now() ||
      workload.leaseGeneration !== scope.generation ||
      workload.projectId !== scope.projectId ||
      workload.runtimeId !== scope.runtimeId ||
      workload.kind !== scope.kind ||
      workload.desiredState !== "running" ||
      !workload.leaseExpiresAt ||
      workload.leaseExpiresAt.getTime() <= this.now()
    )
      throw new Error("Runtime lease is stale or expired")
    return workload
  }

  async connect(
    token: string,
    hello: {
      backendId: string
      projectId: string
      runtimeId: string
      workloadId: string
      kind: string
      generation: number
      minimumProtocolVersion: number
      maximumProtocolVersion: number
    },
    transport: AgentTransport,
  ): Promise<AgentConnection> {
    const scope = this.signer.verify(token)
    return await this.exclusive(scope.workloadId, async () => {
      for (const key of [
        "backendId",
        "projectId",
        "runtimeId",
        "workloadId",
        "kind",
        "generation",
      ] as const)
        if (hello[key] !== scope[key]) throw new Error("Runtime hello does not match credential")
      if (hello.minimumProtocolVersion > 1 || hello.maximumProtocolVersion < 1)
        throw new Error("Unsupported runtime protocol range")
      const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
        where: { id: scope.workloadId },
      })
      if (
        workload.leaseGeneration !== scope.generation ||
        workload.desiredState !== "running" ||
        !workload.leaseExpiresAt ||
        workload.leaseExpiresAt.getTime() <= this.now()
      )
        throw new Error("Runtime lease is stale or expired")
      if (
        workload.projectId !== scope.projectId ||
        workload.runtimeId !== scope.runtimeId ||
        workload.kind !== scope.kind
      )
        throw new Error("Runtime workload scope mismatch")
      // reconnecting the same generation never replays already-dispatched commands
      if (this.connections.current(scope.workloadId))
        await this.interrupt(workload, "Runtime stream replaced")
      const connection = this.connections.register(scope, transport)
      await this.database.backend.runtimeWorkload.updateMany({
        where: { id: workload.id, leaseGeneration: scope.generation },
        data: { connectedAt: new Date(this.now()), status: "running" },
      })
      return connection
    })
  }

  async createAction(input: CreateRuntimeAction): Promise<RuntimeAction> {
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: input.workloadId },
    })
    if (workload.desiredState !== "running" || workload.kind !== input.kind)
      throw new Error("Action does not match an active workload")
    return await this.database.backend.runtimeAction.create({ data: input })
  }

  private result(actionId: string) {
    let pending = this.results.get(actionId)
    if (pending) return pending
    let resolve: (event: AgentEvent) => void = () => {}
    let reject: (error: unknown) => void = () => {}
    const promise = new Promise<AgentEvent>((done, fail) => {
      resolve = done
      reject = fail
    })
    // dispatch and transport failure can precede the consumer's wait
    void promise.catch(() => {})
    pending = { promise, resolve, reject }
    this.results.set(actionId, pending)
    return pending
  }

  async dispatch(actionId: string, payload: unknown, signal?: AbortSignal): Promise<void> {
    if (this.pendingDispatch.has(actionId)) throw new Error("Action dispatch is already pending")
    const action = await this.database.backend.runtimeAction.findUniqueOrThrow({
      where: { id: actionId },
    })
    if (action.status !== "pending") throw new Error("Action cannot be replayed")
    const controller = new AbortController()
    this.pendingDispatch.set(actionId, controller)
    const waitSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    this.result(actionId)
    try {
      const connection = await this.connections.wait(action.workloadId, waitSignal)
      await this.authenticate(connection)
      const updated = await this.database.backend.runtimeAction.updateMany({
        where: { id: actionId, status: "pending", cancellationRequestedAt: null },
        data: { status: "running", startedAt: new Date(this.now()) },
      })
      if (!updated.count) throw new Error("Action was cancelled or dispatched concurrently")
      await this.connections.send(
        connection,
        { type: action.kind === "pulumi" ? "pulumiAction" : "evaluate", actionId, payload },
        waitSignal,
      )
    } catch (error) {
      // once dispatch might have crossed the transport, cancellation must target the remote process
      if (waitSignal.aborted) await this.cancelAction(actionId).catch(() => {})
      const updated = await this.database.backend.runtimeAction.updateMany({
        where: { id: actionId, status: { in: ["pending", "running"] } },
        data: { status: "interrupted", finishedAt: new Date(this.now()), lastError: String(error) },
      })
      if (updated.count) this.result(actionId).reject(error)
      throw error
    } finally {
      this.pendingDispatch.delete(actionId)
    }
  }

  async waitForAction(actionId: string, signal?: AbortSignal): Promise<AgentEvent> {
    const action = await this.database.backend.runtimeAction.findUniqueOrThrow({
      where: { id: actionId },
    })
    const cached = this.results.get(actionId)
    if (!activeActions.includes(action.status as (typeof activeActions)[number]) && !cached)
      throw new Error(`Action "${actionId}" already terminated with status "${action.status}"`)
    return await abortable(this.result(actionId).promise, signal)
  }

  async cancelAction(actionId: string, force = false): Promise<void> {
    const action = await this.database.backend.runtimeAction.findUniqueOrThrow({
      where: { id: actionId },
    })
    if (!activeActions.includes(action.status as (typeof activeActions)[number])) return
    const pending = action.status === "pending"
    const updated = await this.database.backend.runtimeAction.updateMany({
      where: { id: actionId, status: action.status },
      data: {
        cancellationRequestedAt: action.cancellationRequestedAt ?? new Date(this.now()),
        ...(force ? { forceCancellationRequestedAt: new Date(this.now()) } : {}),
        status: pending ? "cancelled" : "cancelling",
        ...(pending ? { finishedAt: new Date(this.now()) } : {}),
      },
    })
    if (!updated.count) return await this.cancelAction(actionId, force)
    if (pending) {
      const error = new Error("Runtime action cancelled before dispatch")
      this.pendingDispatch.get(actionId)?.abort(error)
      this.result(actionId).reject(error)
      return
    }
    const connection = this.connections.current(action.workloadId)
    // cancellation persists even while disconnected; connect never replays the action
    if (connection) {
      await this.authenticate(connection)
      await this.connections.send(connection, {
        type: "cancel",
        actionId,
        requestId: randomUUID(),
        force,
      })
    }
  }

  async receive(connection: AgentConnection, event: AgentEvent): Promise<void> {
    const key = connection.scope.workloadId
    const count = this.eventCounts.get(key) ?? 0
    if (count >= 32) throw new Error("Runtime incoming event queue is full")
    this.eventCounts.set(key, count + 1)
    try {
      await this.exclusive(key, () => this.route(connection, event))
    } finally {
      const remaining = (this.eventCounts.get(key) ?? 1) - 1
      if (remaining) this.eventCounts.set(key, remaining)
      else this.eventCounts.delete(key)
    }
  }

  /** Correlates asynchronous control acknowledgements and request-scoped errors. */
  async request(
    connection: AgentConnection,
    command: AgentCommand,
    signal?: AbortSignal,
  ): Promise<AgentEvent> {
    await this.authenticate(connection)
    if (this.requests.size >= 1024) throw new Error("Runtime request queue is full")
    const requestId = command.requestId ?? randomUUID()
    if (this.requests.has(requestId)) throw new Error("Runtime request ID is already in use")
    let resolve: (event: AgentEvent) => void = () => {}
    let reject: (error: unknown) => void = () => {}
    const pending = new Promise<AgentEvent>((done, fail) => {
      resolve = done
      reject = fail
    })
    void pending.catch(() => {})
    this.requests.set(requestId, { connection, actionId: command.actionId, resolve, reject })
    try {
      await this.connections.send(connection, { ...command, requestId }, signal)
      return await abortable(pending, signal)
    } finally {
      this.requests.delete(requestId)
    }
  }

  private async route(connection: AgentConnection, event: AgentEvent): Promise<void> {
    const workload = await this.authenticate(connection)
    if (event.type === "heartbeat") {
      if (
        !connection.scope.permissions.includes("heartbeat") ||
        event.sequence <= connection.heartbeatSequence
      )
        throw new Error("Invalid runtime heartbeat")
      connection.heartbeatSequence = event.sequence
      const update = await this.database.backend.runtimeWorkload.updateMany({
        where: {
          id: workload.id,
          leaseGeneration: connection.scope.generation,
          desiredState: "running",
          leaseExpiresAt: { gt: new Date(this.now()) },
        },
        data: {
          leaseExpiresAt: new Date(Math.min(this.now() + this.leaseMs, connection.scope.expiresAt)),
        },
      })
      if (!update.count) throw new Error("Runtime lease cannot be renewed")
      return
    }
    const pendingRequest = event.requestId ? this.requests.get(event.requestId) : undefined
    if (pendingRequest) {
      if (pendingRequest.connection !== connection || pendingRequest.actionId !== event.actionId)
        throw new Error("Runtime response ownership mismatch")
      if (event.type === "error") {
        pendingRequest.reject(new Error(event.message))
        return
      }
      if (event.type === "cancelResponse") {
        pendingRequest.resolve(event)
        return
      }
    }
    const permission: RuntimePermission =
      event.type === "workerRegistration"
        ? "worker"
        : event.type === "createSidecar"
          ? "sidecar"
          : event.type === "unitConfiguration" || event.type === "unitResult"
            ? "unit"
            : workload.kind === "composite_evaluation"
              ? "evaluation"
              : "pulumi"
    if (!connection.scope.permissions.includes(permission))
      throw new Error("Runtime event permission denied")
    let action: RuntimeAction | undefined
    if (event.type !== "workerRegistration") {
      if (!event.actionId) throw new Error("Runtime event requires an action ID")
      action = await this.database.backend.runtimeAction.findUniqueOrThrow({
        where: { id: event.actionId },
      })
      if (action.workloadId !== workload.id || !["running", "cancelling"].includes(action.status))
        throw new Error("Runtime action is stale or belongs to another workload")
      if (
        (event.type === "evaluationResult" && action.kind !== "composite_evaluation") ||
        (event.type === "completed" && action.kind !== "pulumi")
      )
        throw new Error("Terminal result does not match action kind")
    } else if (workload.kind !== "worker" || event.actionId)
      throw new Error("Worker event scope mismatch")
    if (["unitConfiguration", "createSidecar"].includes(event.type) && !event.requestId)
      throw new Error("Runtime request requires a request ID")
    const handler = this.handlers.get(workload.kind)
    if (
      !handler &&
      !["completed", "evaluationResult", "error", "cancelResponse"].includes(event.type)
    )
      throw new Error("Runtime domain handler is not registered")
    let response: unknown
    try {
      response = await handler?.event({ workload, action, connection }, event)
    } catch (error) {
      if (event.requestId && ["unitConfiguration", "createSidecar"].includes(event.type)) {
        await this.authenticate(connection)
        await this.connections.send(connection, {
          type: "response",
          actionId: event.actionId,
          requestId: event.requestId,
          payload: { error: { code: "DOMAIN_ERROR", message: String(error) } },
        })
        return
      }
      throw error
    }
    await this.authenticate(connection)
    if (["unitConfiguration", "createSidecar"].includes(event.type)) {
      await this.connections.send(connection, {
        type: "response",
        actionId: event.actionId,
        requestId: event.requestId,
        payload: response,
      })
      return
    }
    const terminal =
      event.type === "completed" ||
      event.type === "evaluationResult" ||
      (event.type === "error" && !event.requestId)
    if (!terminal || !action) return
    const failed = event.type === "error" || (event.type === "completed" && event.exitCode !== 0)
    const status = action.status === "cancelling" ? "cancelled" : failed ? "failed" : "completed"
    const update = await this.database.backend.runtimeAction.updateMany({
      where: {
        id: action.id,
        workload: {
          leaseGeneration: connection.scope.generation,
          leaseExpiresAt: { gt: new Date(this.now()) },
          desiredState: "running",
        },
        status: { in: ["running", "cancelling"] },
      },
      data: {
        status,
        finishedAt: new Date(this.now()),
        lastError: event.type === "error" ? event.message : null,
      },
    })
    if (!update.count) throw new Error("Runtime result superseded")
    this.result(action.id).resolve(event)
  }

  async disconnected(
    connection: AgentConnection,
    reason = "Runtime connection lost",
  ): Promise<void> {
    if (this.connections.current(connection.scope.workloadId) !== connection) return
    this.connections.invalidate(connection.scope.workloadId, new Error(reason))
    for (const [id, request] of this.requests)
      if (request.connection === connection) {
        request.reject(new Error(reason))
        this.requests.delete(id)
      }
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: connection.scope.workloadId },
    })
    if (workload.leaseGeneration === connection.scope.generation)
      await this.interrupt(workload, reason)
  }

  private async interrupt(workload: RuntimeWorkload, reason: string): Promise<void> {
    const actions = await this.database.backend.runtimeAction.findMany({
      where: { workloadId: workload.id, status: { in: ["running", "cancelling"] } },
    })
    for (const action of actions) {
      await this.database.backend.runtimeAction.updateMany({
        where: { id: action.id, status: { in: ["running", "cancelling"] } },
        data: { status: "interrupted", finishedAt: new Date(this.now()), lastError: reason },
      })
      this.result(action.id).reject(new Error(reason))
      await this.handlers.get(workload.kind)?.interrupted?.(action, reason)
    }
  }

  async requestCleanup(workloadId: string): Promise<void> {
    await this.exclusive(workloadId, async () => {
      await this.database.backend.runtimeWorkload.updateMany({
        where: { id: workloadId, cleanedUpAt: null },
        data: {
          desiredState: "deleted",
          cleanupStartedAt: new Date(this.now()),
          status: "stopping",
        },
      })
    })
    await this.cleanup(workloadId)
  }

  async cleanup(workloadId: string, signal?: AbortSignal): Promise<void> {
    const workload = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
      where: { id: workloadId },
    })
    if (workload.cleanedUpAt) return
    if (workload.desiredState !== "deleted") throw new Error("Workload is not marked for cleanup")
    try {
      await this.placements.cancel(workloadId)
      this.connections.invalidate(workloadId, new Error("Runtime workload cleanup requested"))
      await this.interrupt(workload, "Runtime workload cleanup requested")
      for (const action of await this.database.backend.runtimeAction.findMany({
        where: { workloadId, status: "pending" },
      }))
        await this.cancelAction(action.id, true)
      const adapter = await this.adapters.get(workload.runtimeId)
      // adapters remove every generation, including children created before the native root was saved
      await adapter.cleanup(this.ownership(workload), signal)
      await this.database.backend.runtimeWorkload.update({
        where: { id: workloadId },
        data: {
          cleanedUpAt: new Date(this.now()),
          finishedAt: new Date(this.now()),
          status: "completed",
          lastError: null,
        },
      })
    } catch (error) {
      await this.database.backend.runtimeWorkload.update({
        where: { id: workloadId },
        data: { lastError: String(error) },
      })
      throw error
    }
  }

  /** Releases the database owner restriction only after native cleanup has completed. */
  async deleteCleanedWorkload(workloadId: string): Promise<void> {
    const result = await this.database.backend.runtimeWorkload.deleteMany({
      where: { id: workloadId, desiredState: "deleted", cleanedUpAt: { not: null } },
    })
    if (
      !result.count &&
      (await this.database.backend.runtimeWorkload.findUnique({ where: { id: workloadId } }))
    )
      throw new Error("Cannot delete a workload before native cleanup")
  }

  async cleanupProject(projectId: string): Promise<void> {
    const workloads = await this.database.backend.runtimeWorkload.findMany({
      where: { projectId, cleanedUpAt: null },
    })
    const results = await Promise.allSettled(
      workloads.map(workload => this.requestCleanup(workload.id)),
    )
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (failed.length)
      throw new AggregateError(
        failed.map(result => result.reason),
        "Project runtime cleanup failed",
      )
  }

  /** Refreshes a live lease credential without replacing the runner or its actions. */
  async refreshCredential(
    connection: AgentConnection,
    ttlMs = 900_000,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.authenticate(connection)
    if (ttlMs <= 0 || ttlMs > 900_000) throw new Error("Invalid runtime credential lifetime")
    const expiresAt = new Date(this.now() + ttlMs)
    connection.scope.expiresAt = expiresAt.getTime()
    return {
      token: this.signer.issue(connection.scope, connection.scope.permissions, expiresAt.getTime()),
      expiresAt,
    }
  }

  /** Renews an adapter-backed terminal, sidecar, or build lease without an agent stream. */
  async renewBackendLease(workloadId: string, generation: number): Promise<Date> {
    const expiresAt = new Date(this.now() + this.leaseMs)
    const result = await this.database.backend.runtimeWorkload.updateMany({
      where: {
        id: workloadId,
        leaseGeneration: generation,
        desiredState: "running",
        leaseExpiresAt: { gt: new Date(this.now()) },
      },
      data: { leaseExpiresAt: expiresAt },
    })
    if (!result.count) throw new Error("Backend runtime lease is stale or expired")
    return expiresAt
  }

  /** Called at startup and periodically. Never automatically replays a persisted Pulumi action. */
  async reconcile(runtimeId: string, signal?: AbortSignal): Promise<void> {
    const adapter = await this.adapters.get(runtimeId)
    const workloads = await this.database.backend.runtimeWorkload.findMany({
      where: { runtimeId, cleanedUpAt: null },
    })
    const native = await adapter.discover(
      { "highstate.io/backend": this.backendId, "highstate.io/runtime": runtimeId },
      signal,
    )
    const errors: unknown[] = []
    for (const workload of workloads) {
      try {
        if (workload.desiredState === "deleted") {
          await this.cleanup(workload.id, signal)
          continue
        }
        const resources = native.filter(
          resource => resource.labels["highstate.io/workload"] === workload.id,
        )
        const current = resources.find(
          resource =>
            resource.labels["highstate.io/generation"] === String(workload.leaseGeneration),
        )
        if (current)
          await this.database.backend.runtimeWorkload.updateMany({
            where: {
              id: workload.id,
              leaseGeneration: workload.leaseGeneration,
              desiredState: workload.desiredState,
            },
            data: {
              status:
                current.state === "pending"
                  ? "starting"
                  : current.state === "missing"
                    ? "lost"
                    : current.state,
            },
          })
        if (current && !workload.nativeResourceId)
          await this.database.backend.runtimeWorkload.update({
            where: { id: workload.id },
            data: { nativeResourceId: current.id },
          })
        if (!this.connections.current(workload.id))
          await this.interrupt(workload, "Runtime actions interrupted during reconciliation")
        if (
          !workload.leaseExpiresAt ||
          workload.leaseExpiresAt.getTime() <= this.now() ||
          (!current && workload.nativeResourceId)
        ) {
          this.connections.invalidate(workload.id, new Error("Runtime workload lease expired"))
          await this.interrupt(workload, "Runtime workload lost")
          await this.database.backend.runtimeWorkload.update({
            where: { id: workload.id },
            data: {
              status: "lost",
              desiredState: "deleted",
              cleanupStartedAt: new Date(this.now()),
            },
          })
          await this.cleanup(workload.id, signal)
        } else if (workload.desiredState === "stopped" && current)
          await adapter.stop(current.id, false, signal)
      } catch (error) {
        signal?.throwIfAborted()
        errors.push(error)
      }
    }
    // native orphans are safe to remove only inside this backend/runtime ownership scope
    const known = new Set(workloads.map(workload => workload.id))
    for (const resource of native) {
      const labels = resource.labels
      if (
        !["backend", "project", "runtime", "workload", "kind", "generation"].every(
          key => labels[`highstate.io/${key}`],
        )
      )
        continue
      try {
        if (!known.has(labels["highstate.io/workload"]!))
          await adapter.cleanup(
            {
              backendId: this.backendId,
              runtimeId,
              projectId: labels["highstate.io/project"]!,
              workloadId: labels["highstate.io/workload"]!,
              kind: labels["highstate.io/kind"] as RuntimeWorkloadKind,
              generation: Number(labels["highstate.io/generation"]),
            },
            signal,
          )
      } catch (error) {
        signal?.throwIfAborted()
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, "Runtime reconciliation failed")
  }
}
