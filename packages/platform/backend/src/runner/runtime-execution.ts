import type {
  RuntimeAdapterProvider,
  RuntimeCoordinator,
  RuntimeEnvironment,
  RuntimePermission,
  SnapshotImageService,
} from "../container-runtime"
import type { DatabaseManager, RuntimeWorkload } from "../database"

export type RuntimeExecution = {
  workload: RuntimeWorkload
  snapshotId: string
  imageDigest: string
  environment?: RuntimeEnvironment
}

/** Places authenticated agents only after the immutable snapshot image barrier succeeds. */
export class RuntimeExecutionService {
  constructor(
    private readonly database: DatabaseManager,
    readonly coordinator: RuntimeCoordinator,
    readonly adapters: RuntimeAdapterProvider,
    private readonly images: SnapshotImageService,
    private readonly agent: { binary: string; path: string } = {
      binary: "bun",
      path: "/opt/highstate/runtime-agent/main.js",
    },
  ) {}

  async prepare(projectId: string, snapshotIds: string[], signal: AbortSignal): Promise<void> {
    await Promise.all(
      [...new Set(snapshotIds)].map(async snapshotId => {
        await this.images.ensureImage(projectId, snapshotId, signal)
      }),
    )
    signal.throwIfAborted()
  }

  async start(
    projectId: string,
    snapshotId: string,
    kind: "pulumi" | "composite_evaluation",
    ownerId: string,
    signal?: AbortSignal,
    environment?: RuntimeEnvironment,
  ): Promise<RuntimeExecution> {
    const image = await this.images.ensureImage(projectId, snapshotId, signal)
    signal?.throwIfAborted()
    const workload = await this.coordinator.createWorkload({ projectId, kind, ownerId })
    try {
      if (workload.runtimeId !== image.runtimeId)
        throw new Error("Project runtime changed before agent placement")
      const runtime = await this.database.backend.containerRuntime.findUniqueOrThrow({
        where: { id: workload.runtimeId },
      })
      const permissions: RuntimePermission[] =
        kind === "pulumi" ? ["heartbeat", "pulumi", "unit", "sidecar"] : ["heartbeat", "evaluation"]
      const authorization = await this.coordinator.authorize(workload.id, permissions)
      const current = { ...workload, leaseGeneration: authorization.scope.generation }
      const adapter = await this.adapters.get(workload.runtimeId)
      const project =
        kind === "pulumi"
          ? await this.database.backend.project.findUniqueOrThrow({
              where: { id: projectId },
              include: { pulumiStateBackend: true },
            })
          : undefined
      const volumes = project?.pulumiStateBackend.spec.url.startsWith("file:")
        ? [
            {
              name: `hs-pulumi-${project.id}-${project.pulumiStateBackendId}`,
              mountPath: "/var/lib/highstate/pulumi",
            },
          ]
        : []
      if (kind === "pulumi" && !environment)
        environment = await adapter.createEnvironment(this.coordinator.ownership(current), signal)
      const placed = await this.coordinator.place(
        workload.id,
        {
          image: image.reference,
          command: [this.agent.binary, this.agent.path],
          env: {
            HIGHSTATE_AGENT_URL: runtime.spec.runtimeApiUrl,
            HIGHSTATE_AGENT_TOKEN: authorization.token,
            HIGHSTATE_AGENT_SCOPE: JSON.stringify(authorization.scope),
            ...(runtime.spec.runtimeApiCaBundle
              ? { HIGHSTATE_AGENT_CA: runtime.spec.runtimeApiCaBundle }
              : {}),
          },
          environment,
          workingDir: "/opt/highstate/library",
          volumes,
        },
        signal,
      )
      return { workload: placed, snapshotId, imageDigest: image.digest, environment }
    } catch (error) {
      await this.coordinator.requestCleanup(workload.id).catch(() => {})
      throw error
    }
  }
}
