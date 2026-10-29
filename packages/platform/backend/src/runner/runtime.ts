import type { ProjectLibraryService } from "../business/project-library"
import type { AgentEvent, RuntimeDomainContext } from "../container-runtime"
import type { DatabaseManager } from "../database"
import type {
  RunnerBackend,
  UnitDestroyOptions,
  UnitOptions,
  UnitStateOptions,
  UnitStateUpdate,
  UnitUpdateOptions,
} from "./abstractions"
import type { RuntimeArtifactTransfer } from "./runtime-artifacts"
import type { RuntimeExecution, RuntimeExecutionService } from "./runtime-execution"
import type { RuntimeSidecarManager } from "./runtime-sidecars"
import { randomUUID } from "node:crypto"
import { EventEmitter, on } from "node:events"
import { getInstanceId, unitArtifactId, unitArtifactSchema } from "@highstate/contract"
import { z } from "zod"

export interface PulumiActionConfiguration {
  get(projectId: string): Promise<{ url: string; environment: Record<string, string> }>
}

type ActiveAction = { options: UnitOptions; phase: string }

export class RuntimeRunnerBackend implements RunnerBackend {
  private readonly events = new EventEmitter()
  private readonly executions = new Map<string, Promise<RuntimeExecution>>()
  private readonly actions = new Map<string, ActiveAction>()

  constructor(
    private readonly database: DatabaseManager,
    private readonly execution: RuntimeExecutionService,
    private readonly library: ProjectLibraryService,
    private readonly state: PulumiActionConfiguration,
    private readonly sidecars: RuntimeSidecarManager,
    private readonly legacy: RunnerBackend,
    private readonly artifacts: RuntimeArtifactTransfer,
  ) {
    execution.coordinator.registerHandler("pulumi", {
      event: async (context, event) => await this.event(context, event),
    })
  }

  async *watch(options: UnitOptions): AsyncIterable<UnitStateUpdate> {
    // legacy selection is made by the same provenance lookup used for dispatch
    if (await this.isLegacy(options)) {
      yield* this.legacy.watch(options)
      return
    }

    for await (const [update] of on(this.events, this.key(options), { signal: options.signal })) {
      yield update as UnitStateUpdate

      if (update.type === "completion" || update.type === "error") {
        return
      }
    }
  }

  async prepareOperation(
    projectId: string,
    _operationId: string,
    snapshotIds: string[],
    signal: AbortSignal,
  ): Promise<void> {
    await this.execution.prepare(projectId, snapshotIds, signal)
  }

  async update(options: UnitUpdateOptions): Promise<void> {
    await this.enqueue("update", options)
  }

  async preview(options: UnitUpdateOptions): Promise<void> {
    await this.enqueue("preview", options)
  }

  async destroy(options: UnitDestroyOptions): Promise<void> {
    await this.enqueue("destroy", options)
  }

  async refresh(options: UnitOptions): Promise<void> {
    await this.enqueue("refresh", options)
  }

  async deleteState(options: UnitStateOptions): Promise<void> {
    const db = await this.database.forProject(options.projectId)
    const deployed = await db.instanceState.findUnique({ where: { id: options.stateId } })
    if (
      options.libraryId === undefined ||
      options.libraryId === "local" ||
      !deployed?.librarySnapshotId
    ) {
      await this.legacy.deleteState(options)
      return
    }

    const runner = await this.execution.start(
      options.projectId,
      deployed.librarySnapshotId,
      "pulumi",
      randomUUID(),
    )

    let actionId: string | undefined

    try {
      const state = await this.state.get(options.projectId)

      const action = await this.execution.coordinator.createAction({
        workloadId: runner.workload.id,
        kind: "pulumi",
        ownerId: JSON.stringify({
          stateId: options.stateId,
          phase: "delete-state",
          librarySnapshotId: deployed.librarySnapshotId,
        }),
        snapshotId: deployed.librarySnapshotId,
        imageDigest: runner.imageDigest,
      })

      actionId = action.id

      await this.execution.coordinator.dispatch(action.id, {
        action: "destroy",
        stackName: options.stateId,
        stateBackendUrl: state.url,
        stateBackendEnvironment: state.environment,
        stackConfiguration: {
          highstate: JSON.stringify({
            projectName: options.instanceType,
            stateId: options.stateId,
            source: "/opt/highstate/library",
            phase: "delete-state",
            options: {},
          }),
        },
      })

      const result = await this.execution.coordinator.waitForAction(action.id)
      if (result.type !== "completed" || result.exitCode !== 0) {
        throw new Error(result.type === "error" ? result.message : "State deletion failed")
      }
    } finally {
      if (actionId) {
        this.actions.delete(actionId)
      }

      await this.execution.coordinator.requestCleanup(runner.workload.id)
    }
  }

  private key(options: UnitOptions): string {
    return `${options.projectId}/${options.operationId}/${options.stateId}/${options.executionPhase ?? ""}/${options.librarySnapshotId ?? "legacy"}`
  }

  private async isLegacy(options: UnitOptions): Promise<boolean> {
    if (options.librarySnapshotId) {
      return false
    }

    if (options.libraryId === undefined || options.libraryId === "local") {
      return true
    }

    const db = await this.database.forProject(options.projectId)
    const state = await db.instanceState.findUnique({ where: { id: options.stateId } })
    return !state?.librarySnapshotId && state?.status !== "undeployed"
  }

  private async enqueue(
    phase: "update" | "preview" | "destroy" | "refresh",
    options: UnitOptions,
  ): Promise<void> {
    if (await this.isLegacy(options)) {
      if (phase === "update" || phase === "preview") {
        await this.legacy[phase](options as UnitUpdateOptions)
      } else {
        await this.legacy[phase](options)
      }

      return
    }

    // the orchestration watcher must be running before an action can emit its first event
    void this.run(phase, options).catch(error =>
      this.emit(options, {
        type: "error",
        unitId: getInstanceId(options.instanceType, options.instanceName),
        message: String(error),
      }),
    )
  }

  private async run(phase: string, options: UnitOptions): Promise<void> {
    const signal = options.signal
    signal?.throwIfAborted()
    const db = await this.database.forProject(options.projectId)
    const deployed = await db.instanceState.findUniqueOrThrow({ where: { id: options.stateId } })

    const snapshotId =
      options.librarySnapshotId ??
      (phase === "destroy" || phase === "refresh"
        ? deployed.librarySnapshotId
        : (await this.library.desiredSnapshot(options.projectId)).id)

    if (!snapshotId) {
      throw new Error("Historical execution requires the retained legacy environment")
    }

    const key = `${options.projectId}/${options.operationId}/${snapshotId}`
    let pending = this.executions.get(key)
    if (!pending) {
      const sibling = [...this.executions.entries()].find(([key]) =>
        key.startsWith(`${options.projectId}/${options.operationId}/`),
      )

      pending = (async () =>
        await this.execution.start(
          options.projectId,
          snapshotId,
          "pulumi",
          options.operationId,
          signal,
          sibling ? (await sibling[1]).environment : undefined,
        ))()

      this.executions.set(key, pending)
    }

    const runner = await pending
    signal?.throwIfAborted()

    const source = (
      await this.library.getSnapshotUnitSources(options.projectId, snapshotId, [
        options.instanceType,
      ])
    )[0]!

    await db.instanceOperationState.update({
      where: {
        operationId_stateId: { operationId: options.operationId, stateId: options.stateId },
      },
      data: {
        librarySnapshotId: snapshotId,
        libraryPackageVersionId: source.libraryPackageVersionId,
        previousLibraryPackageVersionId: deployed.libraryPackageVersionId,
      },
    })

    const state = await this.state.get(options.projectId)

    const action = await this.execution.coordinator.createAction({
      workloadId: runner.workload.id,
      kind: "pulumi",
      ownerId: JSON.stringify({
        operationId: options.operationId,
        stateId: options.stateId,
        phase: options.executionPhase ?? phase,
        librarySnapshotId: snapshotId,
        libraryPackageVersionId: source.libraryPackageVersionId,
        previousLibraryPackageVersionId: deployed.libraryPackageVersionId,
      }),
      snapshotId,
      imageDigest: runner.imageDigest,
    })

    const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runner.workload.runtimeId },
    })

    const transfer = this.artifacts.issue(runtime.spec.runtimeApiUrl, {
      projectId: options.projectId,
      stateId: options.stateId,
      reads: new Map(
        ((options as UnitUpdateOptions).artifacts ?? []).map(artifact => [artifact.hash, artifact]),
      ),
      writable: phase !== "preview",
      validate: async () => {
        const connection = this.execution.coordinator.connections.current(runner.workload.id)
        if (!connection) {
          throw new Error("Runtime disconnected")
        }

        await this.execution.coordinator.authenticate(connection)

        const current = await this.database.backend.runtimeAction.findUniqueOrThrow({
          where: { id: action.id },
        })

        if (current.status !== "running") {
          throw new Error("Artifact action is no longer running")
        }
      },
    })

    this.actions.set(action.id, { options, phase })

    const cancel = () => {
      void this.execution.coordinator.cancelAction(action.id).catch(() => {})
    }

    const force = () => {
      void this.execution.coordinator.cancelAction(action.id, true).catch(() => {})
    }

    signal?.addEventListener("abort", cancel, { once: true })
    options.forceSignal?.addEventListener("abort", force, { once: true })

    try {
      signal?.throwIfAborted()

      await this.execution.coordinator.dispatch(
        action.id,
        {
          action: phase,
          stackName: options.stateId,
          stateBackendUrl: state.url,
          stateBackendEnvironment: state.environment,
          stackConfiguration: {
            highstate: JSON.stringify({
              source: `/opt/highstate/library/${source.relativePath}`,
              projectName: options.instanceType,
              stateId: options.stateId,
              phase,
              artifactUrl: transfer.url,
              artifactHashes: [
                ...((options as UnitUpdateOptions).artifacts ?? []).map(artifact => artifact.hash),
              ],
              options: { ...options, signal: undefined, forceSignal: undefined },
            }),
          },
          debug: options.debug,
        },
        signal,
      )

      const result = await this.execution.coordinator.waitForAction(action.id)
      if (result.type === "error") {
        throw new Error(result.message)
      }

      if (result.type !== "completed" || result.exitCode !== 0) {
        throw new Error("Pulumi action failed")
      }

      signal?.throwIfAborted()
      const rawOutputs = result.result as import("./abstractions").RawPulumiOutputs
      if (phase !== "preview" && rawOutputs?.$artifacts) {
        const declared = z
          .record(z.string(), unitArtifactSchema.array())
          .parse(rawOutputs.$artifacts.value)

        for (const item of Object.values(declared).flat()) {
          const stored = await db.artifact.findUniqueOrThrow({ where: { hash: item.hash } })
          item[unitArtifactId] = stored.id
        }

        rawOutputs.$artifacts.value = declared
      }

      this.emit(options, {
        type: "completion",
        unitId: getInstanceId(options.instanceType, options.instanceName),
        operationType: phase === "preview" ? "update" : (phase as "update" | "destroy" | "refresh"),
        rawOutputs,
        provenance: {
          librarySnapshotId: snapshotId,
          libraryPackageVersionId: source.libraryPackageVersionId,
        },
      })
    } finally {
      transfer.close()
      signal?.removeEventListener("abort", cancel)
      options.forceSignal?.removeEventListener("abort", force)
      this.actions.delete(action.id)
    }
  }

  private emit(options: UnitOptions, update: UnitStateUpdate): void {
    this.events.emit(this.key(options), update)
  }

  private async event(context: RuntimeDomainContext, event: AgentEvent): Promise<unknown> {
    const active = event.actionId ? this.actions.get(event.actionId) : undefined
    if (!active) {
      const owner = context.action
        ? (JSON.parse(context.action.ownerId) as { phase?: string })
        : undefined

      if (
        owner?.phase === "delete-state" &&
        ["completed", "error", "output", "engineEvent"].includes(event.type)
      ) {
        return
      }

      throw new Error("Unknown runner action")
    }

    const { options } = active

    if (event.type === "unitConfiguration" || event.type === "unitResult") {
      const payload = event.payload as { stateId: string; phase?: string }
      if (
        payload.stateId !== options.stateId ||
        (event.type === "unitConfiguration" &&
          payload.phase !== (options.executionPhase ?? active.phase))
      ) {
        throw new Error("Unit request does not match its owning action")
      }
    }

    const unitId = getInstanceId(options.instanceType, options.instanceName)

    if (event.type === "unitConfiguration") {
      if (!options.config) {
        throw new Error("Action has no unit configuration")
      }

      return { ...options.config, importBasePath: "/opt/highstate/library/package.json" }
    }

    if (event.type === "createSidecar") {
      const runner = await this.executions.get(
        `${options.projectId}/${options.operationId}/${context.action?.snapshotId}`,
      )

      return await this.sidecars.start(
        context,
        event.payload,
        message => this.emit(options, { type: "message", unitId, message }),
        runner?.environment,
      )
    }

    if (event.type === "output") {
      const payload = event.payload as { data: Uint8Array }
      this.emit(options, { type: "message", unitId, message: Buffer.from(payload.data).toString() })
    }

    return undefined
  }

  async finishOperation(projectId: string, operationId: string): Promise<void> {
    await this.sidecars.finishOperation(projectId, operationId)
    const prefix = `${projectId}/${operationId}/`
    const pending = [...this.executions.entries()].filter(([key]) => key.startsWith(prefix))

    for (const [key, execution] of pending.reverse()) {
      try {
        await this.execution.coordinator.requestCleanup((await execution).workload.id)
      } finally {
        this.executions.delete(key)
      }
    }

    await this.legacy.finishOperation?.(projectId, operationId)
  }
}
