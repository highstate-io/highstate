import type { ProjectPlacementInput } from "../shared/models/backend/project"
import type { DatabaseManager } from "./manager"
import { localContainerRuntime, ProjectNotFoundError } from "../shared"

/**
 * Changes placement only after persistent workloads and project activity have stopped.
 * Disabling an unsupported overlay happens first so a partial cross-database failure stays executable.
 */
export async function updateProjectPlacement(
  database: DatabaseManager,
  projectId: string,
  input: ProjectPlacementInput,
): Promise<void> {
  const projectDatabase = await database.forProject(projectId)

  await database.backend.$transaction(async tx => {
    const project = await tx.project.findUnique({ where: { id: projectId } })
    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    const runtime = await tx.containerRuntime.findUniqueOrThrow({
      where: { id: input.containerRuntimeId },
    })
    await tx.pulumiStateBackend.findUniqueOrThrow({ where: { id: input.pulumiStateBackendId } })
    const local =
      runtime.id === localContainerRuntime.id &&
      runtime.spec.type === "docker" &&
      runtime.spec.local
    if (input.localOverlayEnabled && !local) {
      throw new Error("Local library overlays require the well-known local Docker runtime")
    }

    const workload = await tx.runtimeWorkload.findFirst({
      where: {
        projectId,
        OR: [
          { status: { in: ["pending", "starting", "running", "stopping"] } },
          { cleanedUpAt: null },
        ],
      },
      select: { id: true },
    })
    if (workload) {
      throw new Error(`Project "${projectId}" still has active or uncleaned runtime workloads`)
    }

    // Project databases are separate persistence realms; never re-enable an overlay implicitly.
    await projectDatabase.$transaction(async projectTx => {
      const [operation, terminal, worker] = await Promise.all([
        projectTx.operation.findFirst({
          where: { status: { in: ["pending", "running", "failing", "cancelling"] } },
          select: { id: true },
        }),
        projectTx.terminalSession.findFirst({ where: { finishedAt: null }, select: { id: true } }),
        projectTx.workerVersion.findFirst({
          where: { status: { in: ["starting", "running", "stopping"] } },
          select: { id: true },
        }),
      ])
      if (operation || terminal || worker) {
        throw new Error(`Project "${projectId}" still has active operations, terminals, or workers`)
      }

      const state = await projectTx.projectLibraryState.findUniqueOrThrow({
        where: { id: "default" },
      })
      const overlayEnabled = local
        ? (input.localOverlayEnabled ?? state.localOverlayEnabled)
        : false
      if (
        overlayEnabled !== state.localOverlayEnabled ||
        project.containerRuntimeId !== input.containerRuntimeId
      ) {
        await projectTx.instanceEvaluationState.deleteMany()
      }
      await projectTx.projectLibraryState.update({
        where: { id: "default" },
        data: { localOverlayEnabled: overlayEnabled },
      })
    })

    await tx.project.update({
      where: { id: projectId },
      data: {
        containerRuntimeId: input.containerRuntimeId,
        pulumiStateBackendId: input.pulumiStateBackendId,
      },
    })
  })
}
