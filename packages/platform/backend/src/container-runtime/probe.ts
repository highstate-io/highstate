import type { DatabaseManager } from "../database"
import type { RuntimeCoordinator } from "./coordinator"
import { randomUUID } from "node:crypto"

export type RuntimeWorkloadProbeOptions = {
  image?: string
  agent: { binary: string; path: string }
  timeoutMs?: number
}

/** Verifies that a disposable workload can open an authenticated runtime agent stream. */
export class RuntimeWorkloadProbe {
  constructor(
    private readonly database: DatabaseManager,
    private readonly coordinator: RuntimeCoordinator,
    private readonly options: RuntimeWorkloadProbeOptions,
  ) {
    if (!Number.isSafeInteger(options.timeoutMs ?? 30_000) || (options.timeoutMs ?? 30_000) <= 0)
      throw new Error("Runtime probe timeout must be a positive integer in milliseconds")
  }

  /**
   * Places the configured base image on an existing assigned project and waits for authentication.
   * Always requests native cleanup after workload creation, including on cancellation or failure.
   */
  async probe(runtimeId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const image = this.options.image?.trim()
    if (!image)
      throw new Error("Configure a runtime base image containing the runtime agent before probing")

    const controller = new AbortController()
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error(
            `Runtime probe for "${runtimeId}" timed out; check the base image agent, runtime API URL, CA bundle, and workload network access`,
          ),
        ),
      this.options.timeoutMs ?? 30_000,
    )
    const waitSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    let workloadId: string | undefined
    const errors: unknown[] = []
    try {
      const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
        where: { id: runtimeId },
      })
      const project = await this.database.backend.project.findFirst({
        where: { containerRuntimeId: runtimeId },
        orderBy: { id: "asc" },
        select: { id: true },
      })
      if (!project)
        throw new Error(
          `Assign an existing project to container runtime "${runtimeId}" before probing`,
        )

      waitSignal.throwIfAborted()
      const workload = await this.coordinator.createWorkload({
        projectId: project.id,
        kind: "composite_evaluation",
        ownerId: `runtime-probe:${randomUUID()}`,
      })
      workloadId = workload.id
      if (workload.runtimeId !== runtimeId)
        throw new Error(`Project runtime changed before probing "${runtimeId}"; retry the probe`)

      waitSignal.throwIfAborted()
      const authorization = await this.coordinator.authorize(workload.id, [
        "connect",
        "heartbeat",
        "evaluation",
      ])
      waitSignal.throwIfAborted()
      await this.coordinator.place(
        workload.id,
        {
          image,
          command: [this.options.agent.binary, this.options.agent.path],
          env: {
            HIGHSTATE_AGENT_URL: runtime.spec.runtimeApiUrl,
            HIGHSTATE_AGENT_TOKEN: authorization.token,
            HIGHSTATE_AGENT_SCOPE: JSON.stringify(authorization.scope),
            ...(runtime.spec.runtimeApiCaBundle
              ? { HIGHSTATE_AGENT_CA: runtime.spec.runtimeApiCaBundle }
              : {}),
          },
        },
        waitSignal,
      )
      const connection = await this.coordinator.connections.wait(workload.id, waitSignal)
      await this.coordinator.authenticate(connection)
      waitSignal.throwIfAborted()
    } catch (error) {
      errors.push(error)
    } finally {
      clearTimeout(timeout)
      if (workloadId) {
        try {
          // cleanup must outlive the cancelled or timed-out probe signal
          await this.coordinator.requestCleanup(workloadId)
        } catch (cause) {
          errors.push(
            new Error(`Failed to clean up runtime probe workload "${workloadId}"`, { cause }),
          )
        }
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length)
      throw new AggregateError(errors, `Runtime probe for "${runtimeId}" and cleanup failed`)
  }
}
