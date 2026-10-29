import type { DatabaseManager } from "../database"

/**
 * Removes only library history that has no desired, deployed, evaluation, or execution owner.
 */
export class ProjectLibraryGarbageCollector {
  constructor(private readonly database: DatabaseManager) {}

  async collect(projectId: string): Promise<{ snapshots: number; packageVersions: number }> {
    const actions = await this.database.backend.runtimeAction.findMany({
      where: { workload: { projectId }, snapshotId: { not: null } },
      select: { snapshotId: true },
    })

    const builds = await this.database.backend.runtimeWorkload.findMany({
      where: { projectId, kind: "library_build", cleanedUpAt: null },
      select: { ownerId: true },
    })

    const retained = [
      ...new Set([
        ...actions.map(action => action.snapshotId!),
        ...builds.map(build => build.ownerId),
      ]),
    ]

    const project = await this.database.forProject(projectId)

    const removed = await project.$transaction(async tx => {
      const where = {
        id: { notIn: retained },
        desiredBy: { none: {} },
        operations: { none: {} },
        evaluationStates: { none: {} },
        versions: { every: { instanceStates: { none: {} }, operationStates: { none: {} } } },
      }

      const candidates = await tx.librarySnapshot.findMany({ where, select: { id: true } })

      await tx.librarySnapshot.deleteMany({
        where: { ...where, id: { in: candidates.map(snapshot => snapshot.id), notIn: retained } },
      })

      const versions = await tx.libraryPackageVersion.deleteMany({
        where: { snapshots: { none: {} }, previousOperationStates: { none: {} } },
      })

      return { ids: candidates.map(snapshot => snapshot.id), packageVersions: versions.count }
    })

    // image records are disposable caches; runtime actions and uncleaned builds were retained above
    await this.database.backend.librarySnapshotImage.deleteMany({
      where: { projectId, snapshotId: { in: removed.ids } },
    })

    return { snapshots: removed.ids.length, packageVersions: removed.packageVersions }
  }
}
