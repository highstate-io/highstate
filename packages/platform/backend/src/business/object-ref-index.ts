import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { ProjectDatabase } from "../database/prisma"

const objectRefBatchSize = 500

type IdRow = { id: string }

type CuratedIdResolver = (database: ProjectDatabase) => Promise<IdRow[]>

const curatedIdResolvers: CuratedIdResolver[] = [
  async database => await database.operation.findMany({ select: { id: true } }),
  async database => await database.instanceState.findMany({ select: { id: true } }),
  async database => await database.artifact.findMany({ select: { id: true } }),
  async database => await database.page.findMany({ select: { id: true } }),
  async database => await database.terminal.findMany({ select: { id: true } }),
  async database => await database.terminalSession.findMany({ select: { id: true } }),
  async database => await database.secret.findMany({ select: { id: true } }),
  async database => await database.serviceAccount.findMany({ select: { id: true } }),
  async database => await database.apiKey.findMany({ select: { id: true } }),
  async database => await database.trigger.findMany({ select: { id: true } }),
  async database => await database.unlockMethod.findMany({ select: { id: true } }),
  async database => await database.worker.findMany({ select: { id: true } }),
  async database => await database.workerVersion.findMany({ select: { id: true } }),
  async database => await database.entitySnapshot.findMany({ select: { id: true } }),
  async database => await database.entity.findMany({ select: { id: true } }),
]

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be positive")
  }

  const result: T[][] = []

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }

  return result
}

function normalizeIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map(id => id.trim()).filter(Boolean)))
}

/**
 * Maintains the global backend object reference index.
 *
 * The index is stored in the backend database as `(id, projectId)` pairs.
 * It is used by `GlobalSearchService.searchByIds()` to quickly find which projects
 * may contain a given object ID.
 *
 * This service only indexes the curated list of project collections used by global object search.
 */
export class ObjectRefIndexService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Tracks the provided object IDs for the given project.
   *
   * This is a best-effort helper for incremental updates.
   * It never deletes references.
   *
   * @param projectId The ID of the project that knows the objects.
   * @param ids The list of object IDs.
   */
  async track(projectId: string, ids: string[]): Promise<void> {
    const uniqueIds = normalizeIds(ids)

    if (uniqueIds.length === 0) {
      return
    }

    try {
      for (const batch of chunk(uniqueIds, objectRefBatchSize)) {
        const existing = await this.database.backend.object.findMany({
          where: {
            projectId,
            id: {
              in: batch,
            },
          },
          select: {
            id: true,
          },
        })

        const existingIds = new Set(existing.map(r => r.id))
        const toCreate = batch.filter(id => !existingIds.has(id))
        if (toCreate.length === 0) {
          continue
        }

        await this.database.backend.object.createMany({
          data: toCreate.map(id => ({ id, projectId })),
        })
      }
    } catch (error) {
      this.logger.warn({ error, projectId }, 'failed to track object refs for project "%s"', projectId)
    }
  }

  /**
   * Reconciles backend object references for the given project.
   *
   * It queries the curated set of project collections and makes backend.object match.
   * This method requires the project database to be accessible (project must be unlocked).
   *
   * @param projectId The ID of the project to sync.
   */
  async syncProject(projectId: string): Promise<void> {
    let projectDatabase: ProjectDatabase

    try {
      projectDatabase = await this.database.forProject(projectId)
    } catch (error) {
      this.logger.debug({ error, projectId }, 'failed to open project database for object ref sync')
      return
    }

    const [expectedIds, existingRows] = await Promise.all([
      this.collectCuratedProjectObjectIds(projectDatabase, projectId),
      this.database.backend.object.findMany({
        where: { projectId },
        select: { id: true },
      }),
    ])

    const existingIds = new Set(existingRows.map(r => r.id))

    const toCreate: string[] = []
    for (const id of expectedIds) {
      if (!existingIds.has(id)) {
        toCreate.push(id)
      }
    }

    const expectedSet = new Set(expectedIds)
    const toDelete: string[] = []
    for (const id of existingIds) {
      if (!expectedSet.has(id)) {
        toDelete.push(id)
      }
    }

    for (const batch of chunk(toCreate, objectRefBatchSize)) {
      await this.database.backend.object.createMany({
        data: batch.map(id => ({ id, projectId })),
      })
    }

    for (const batch of chunk(toDelete, objectRefBatchSize)) {
      await this.database.backend.object.deleteMany({
        where: {
          projectId,
          id: {
            in: batch,
          },
        },
      })
    }
  }

  private async collectCuratedProjectObjectIds(
    database: ProjectDatabase,
    projectId: string,
  ): Promise<string[]> {
    const settled = await Promise.allSettled(curatedIdResolvers.map(async r => await r(database)))

    const ids = new Set<string>()

    for (const result of settled) {
      if (result.status === "rejected") {
        this.logger.debug(
          { error: result.reason, projectId },
          "curated object id resolver failed",
        )
        continue
      }

      for (const row of result.value) {
        ids.add(row.id)
      }
    }

    return Array.from(ids)
  }
}
