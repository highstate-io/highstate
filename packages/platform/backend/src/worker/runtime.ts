import type {
  AgentEvent,
  RuntimeAdapterProvider,
  RuntimeCoordinator,
  RuntimeDomainContext,
} from "../container-runtime"
import type { DatabaseManager } from "../database"
import type { PanelEndpointManager } from "../panel"
import type { PubSubManager } from "../pubsub"
import type { WorkerBackend, WorkerRunOptions } from "./abstractions"
import { once } from "node:events"
import { delay } from "../container-runtime"

export type RuntimeWorkerOptions = {
  publicApiUrl: string
  onRunning: (projectId: string, workerVersionId: string, workerInstanceId: string) => Promise<void>
  onError: (error: unknown) => void
}

export class RuntimeWorkerBackend implements WorkerBackend {
  private readonly running = new Map<string, WorkerRunOptions>()
  private readonly streams = new Map<string, AbortController>()

  constructor(
    private readonly coordinator: RuntimeCoordinator,
    private readonly adapters: RuntimeAdapterProvider,
    private readonly database: DatabaseManager,
    private readonly pubsub: PubSubManager,
    private readonly panels: PanelEndpointManager,
    private readonly options: RuntimeWorkerOptions,
  ) {
    coordinator.registerHandler("worker", { event: (context, event) => this.event(context, event) })
    coordinator.connections.onInvalidated(workloadId => {
      this.streams.get(workloadId)?.abort()
      this.streams.delete(workloadId)
      const worker = this.running.get(workloadId)
      if (worker) this.panels.disconnect(worker.workerInstanceId)
    })
  }

  private async event(
    { workload, connection }: RuntimeDomainContext,
    event: AgentEvent,
  ): Promise<void> {
    if (event.type !== "workerRegistration") throw new Error("Unexpected worker runtime event")
    const worker = this.running.get(workload.id)
    const identity = event.payload as { workerVersionId?: string; workerInstanceId?: string }
    if (
      !worker ||
      workload.ownerId !== worker.workerVersionId ||
      identity.workerVersionId !== worker.workerVersionId ||
      identity.workerInstanceId !== worker.workerInstanceId
    )
      throw new Error("Worker runtime registration does not match the launched instance")
    if (this.streams.has(workload.id)) throw new Error("Worker already registered on this stream")
    await this.options.onRunning(worker.projectId, worker.workerVersionId, worker.workerInstanceId)
    await this.coordinator.authenticate(connection)
    this.panels.connectRuntime(
      worker.projectId,
      worker.workerVersionId,
      worker.workerInstanceId,
      workload.id,
    )
    const controller = new AbortController()
    this.streams.set(workload.id, controller)
    void this.control(workload.id, connection, worker, controller.signal).catch(error => {
      if (!controller.signal.aborted) {
        this.options.onError(error)
        void this.coordinator.disconnected(connection, "Worker registration stream failed")
      }
    })
  }

  private async control(
    workloadId: string,
    connection: RuntimeDomainContext["connection"],
    worker: WorkerRunOptions,
    signal: AbortSignal,
  ): Promise<void> {
    // subscribe before reading the snapshot so concurrent changes cannot be missed
    const changes = await this.pubsub.subscribe(
      ["worker-unit-registration", worker.projectId, worker.workerVersionId],
      signal,
    )
    const iterator = changes[Symbol.asyncIterator]()
    let pending = iterator.next()
    void pending.catch(() => {})
    const database = await this.database.forProject(worker.projectId)
    const registrations = await database.workerUnitRegistration.findMany({
      where: { workerVersionId: worker.workerVersionId },
      select: { stateId: true, params: true },
    })
    const send = async (
      control: Parameters<RuntimeCoordinator["connections"]["send"]>[1] & { type: "workerControl" },
    ) => {
      signal.throwIfAborted()
      if (this.running.get(workloadId) !== worker) throw new Error("Worker instance replaced")
      await this.coordinator.authenticate(connection)
      await this.coordinator.connections.send(connection, control, signal)
    }
    for (const registration of registrations) {
      await send({
        type: "workerControl",
        control: {
          type: "register",
          stateId: registration.stateId,
          params: registration.params as Record<string, unknown>,
        },
      })
    }
    for (;;) {
      const next = await pending
      if (next.done) break
      const change = next.value
      pending = iterator.next()
      void pending.catch(() => {})
      await send({
        type: "workerControl",
        control:
          change.type === "registered"
            ? {
                type: "register",
                stateId: change.stateId,
                params: change.params as Record<string, unknown>,
              }
            : { type: "deregister", stateId: change.stateId },
      })
    }
  }

  async run(options: WorkerRunOptions): Promise<void> {
    const { projectId, workerVersionId, workerInstanceId, image, apiKey, stdout, signal } = options
    signal?.throwIfAborted()
    const workload = await this.coordinator.createWorkload({
      projectId,
      kind: "worker",
      ownerId: workerVersionId,
    })
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    this.running.set(workload.id, options)
    let logs: Promise<void> | undefined
    // credentials are deliberately short lived; supervision obtains a new lease before expiry
    const expiration = setTimeout(
      () => controller.abort(new Error("Worker runtime credential rotation required")),
      840_000,
    )
    expiration.unref()
    try {
      const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
        where: { id: workload.runtimeId },
      })
      const authorization = await this.coordinator.authorize(workload.id, [
        "connect",
        "heartbeat",
        "worker",
        "proxy",
      ])
      const runOptions = {
        projectId,
        workerVersionId,
        workerInstanceId,
        apiKey,
        apiUrl: this.options.publicApiUrl,
        runtimeApiUrl: runtime.spec.runtimeApiUrl,
        runtimeApiCaBundle: runtime.spec.runtimeApiCaBundle,
        runtimeToken: authorization.token,
        scope: authorization.scope,
      }
      const placed = await this.coordinator.place(
        workload.id,
        {
          image,
          mode: "deployment",
          env: { HIGHSTATE_WORKER_RUN_OPTIONS: JSON.stringify(runOptions) },
        },
        combined,
      )
      const adapter = await this.adapters.get(workload.runtimeId)
      while ((await adapter.inspect(placed.nativeResourceId!, combined)).state === "pending")
        await delay(100, combined)
      logs = (async () => {
        for await (const log of adapter.logs(placed.nativeResourceId!, true, combined)) {
          if (!stdout.write(log.data)) await once(stdout, "drain", { signal: combined })
        }
      })()
      void logs.catch(error => controller.abort(error))
      for (;;) {
        const state = await adapter.inspect(placed.nativeResourceId!, combined)
        if (!["running", "pending"].includes(state.state)) {
          if (state.state !== "completed") throw new Error("Worker workload exited unsuccessfully")
          break
        }
        await delay(500, combined)
      }
      await logs
    } finally {
      clearTimeout(expiration)
      controller.abort()
      await logs?.catch(() => {})
      this.streams.get(workload.id)?.abort()
      this.streams.delete(workload.id)
      this.panels.disconnect(workerInstanceId)
      this.running.delete(workload.id)
      await this.coordinator.requestCleanup(workload.id)
    }
  }
}
