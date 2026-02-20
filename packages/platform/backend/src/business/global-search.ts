import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { ProjectUnlockBackend } from "../unlock"
import type { ProjectDatabase } from "../database/prisma"
import { commonObjectMetaSchema, type CommonObjectMeta } from "@highstate/contract"

export type GlobalSearchObjectKind =
  | "apiKey"
  | "artifact"
  | "entity"
  | "entitySnapshot"
  | "instanceState"
  | "operation"
  | "page"
  | "secret"
  | "serviceAccount"
  | "terminal"
  | "terminalSession"
  | "trigger"
  | "unlockMethod"
  | "worker"
  | "workerVersion"

export type GlobalSearchHit = {
  kind: GlobalSearchObjectKind
  id: string
  meta: CommonObjectMeta
}

function createSearchHits<TItem extends { id: string }>(
  kind: GlobalSearchObjectKind,
  items: TItem[],
  metaExtractor: (item: TItem) => unknown,
  logger: Logger,
): GlobalSearchHit[] {
  return items.map(item => {
    const metaResult = commonObjectMetaSchema.safeParse(metaExtractor(item))

    if (!metaResult.success) {
      logger.warn(
        { itemId: item.id, kind, error: metaResult.error },
        "failed to parse meta for search hit, using fallback",
      )

      return {
        kind,
        id: item.id,
        meta: {
          title: item.id,
        },
      }
    }

    return {
      kind,
      id: item.id,
      meta: metaResult.data,
    }
  })
}

export type GlobalSearchProjectResult =
  | {
      projectId: string
      unlockState: "locked"
    }
  | {
      projectId: string
      unlockState: "unlocked"
      hits: GlobalSearchHit[]
    }

export type GlobalSearchResult = {
  id: string
  projects: GlobalSearchProjectResult[]
}

type ProjectSearchResolver = (
  database: ProjectDatabase,
  ids: string[],
  logger: Logger,
) => Promise<GlobalSearchHit[]>

const projectSearchResolvers: ProjectSearchResolver[] = [
  async (database, ids, logger) => {
    const operations = await database.operation.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("operation", operations, operation => operation.meta, logger)
  },
  async (database, ids, logger) => {
    const states = await database.instanceState.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        instanceId: true,
        status: true,
      },
    })

    return createSearchHits(
      "instanceState",
      states,
      state => ({
        title: state.instanceId,
        description: `${state.status}`,
      }),
      logger,
    )
  },
  async (database, ids, logger) => {
    const artifacts = await database.artifact.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("artifact", artifacts, artifact => artifact.meta, logger)
  },
  async (database, ids, logger) => {
    const pages = await database.page.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("page", pages, page => page.meta, logger)
  },
  async (database, ids, logger) => {
    const terminals = await database.terminal.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("terminal", terminals, terminal => terminal.meta, logger)
  },
  async (database, ids, logger) => {
    const sessions = await database.terminalSession.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        terminal: {
          select: {
            meta: true,
          },
        },
      },
    })

    return createSearchHits("terminalSession", sessions, session => session.terminal.meta, logger)
  },
  async (database, ids, logger) => {
    const secrets = await database.secret.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("secret", secrets, secret => secret.meta, logger)
  },
  async (database, ids, logger) => {
    const accounts = await database.serviceAccount.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("serviceAccount", accounts, account => account.meta, logger)
  },
  async (database, ids, logger) => {
    const apiKeys = await database.apiKey.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("apiKey", apiKeys, apiKey => apiKey.meta, logger)
  },
  async (database, ids, logger) => {
    const triggers = await database.trigger.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("trigger", triggers, trigger => trigger.meta, logger)
  },
  async (database, ids, logger) => {
    const unlockMethods = await database.unlockMethod.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits(
      "unlockMethod",
      unlockMethods,
      unlockMethod => unlockMethod.meta,
      logger,
    )
  },
  async (database, ids, logger) => {
    const workers = await database.worker.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        identity: true,
        versions: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            meta: true,
          },
        },
      },
    })

    return createSearchHits("worker", workers, worker => worker.versions[0]?.meta, logger)
  },
  async (database, ids, logger) => {
    const versions = await database.workerVersion.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("workerVersion", versions, version => version.meta, logger)
  },
  async (database, ids, logger) => {
    const snapshots = await database.entitySnapshot.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        meta: true,
      },
    })

    return createSearchHits("entitySnapshot", snapshots, snapshot => snapshot.meta, logger)
  },
  async (database, ids, logger) => {
    const entities = await database.entity.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        type: true,
        identity: true,
        snapshots: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            meta: true,
          },
        },
      },
    })

    return createSearchHits("entity", entities, entity => entity.snapshots[0]?.meta, logger)
  },
]

export class GlobalSearchService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly projectUnlockBackend: ProjectUnlockBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Searches for objects by their IDs across all projects that reference them.
   *
   * For locked projects, it only returns that the project has a match.
   * For unlocked projects, it queries a curated set of collections to find matching objects.
   *
   * @param ids The list of object IDs to search for.
   */
  async searchByIds(ids: string[]): Promise<GlobalSearchResult[]> {
    const uniqueIds = Array.from(new Set(ids.map(id => id.trim()).filter(Boolean)))

    if (uniqueIds.length === 0) {
      return []
    }

    const indexed = await this.database.backend.object.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
      select: {
        id: true,
        projectId: true,
      },
    })

    const idsByProjectId = new Map<string, Set<string>>()

    for (const row of indexed) {
      const existingIds = idsByProjectId.get(row.projectId) ?? new Set<string>()
      existingIds.add(row.id)
      idsByProjectId.set(row.projectId, existingIds)
    }

    const projectsById = new Map<string, GlobalSearchProjectResult[]>()

    for (const projectId of idsByProjectId.keys()) {
      const idsInProject = Array.from(idsByProjectId.get(projectId) ?? [])

      if (idsInProject.length === 0) {
        continue
      }

      const isUnlocked = await this.projectUnlockBackend.checkProjectUnlocked(projectId)

      if (!isUnlocked) {
        for (const id of idsInProject) {
          const existing = projectsById.get(id) ?? []
          existing.push({ projectId, unlockState: "locked" })
          projectsById.set(id, existing)
        }
        continue
      }

      try {
        const projectDatabase = await this.database.forProject(projectId)
        const hitsById = await this.searchInUnlockedProject(projectDatabase, idsInProject)

        for (const id of idsInProject) {
          const hits = hitsById.get(id) ?? []

          const existing = projectsById.get(id) ?? []
          existing.push({ projectId, unlockState: "unlocked", hits })
          projectsById.set(id, existing)
        }
      } catch (error) {
        this.logger.error(
          { error, projectId },
          'failed to search in unlocked project "%s"',
          projectId,
        )

        for (const id of idsInProject) {
          const existing = projectsById.get(id) ?? []
          existing.push({ projectId, unlockState: "unlocked", hits: [] })
          projectsById.set(id, existing)
        }
      }
    }

    return uniqueIds.map(id => ({ id, projects: projectsById.get(id) ?? [] }))
  }

  private async searchInUnlockedProject(
    database: ProjectDatabase,
    ids: string[],
  ): Promise<Map<string, GlobalSearchHit[]>> {
    const settled = await Promise.allSettled(
      projectSearchResolvers.map(async r => await r(database, ids, this.logger)),
    )

    const hitsById = new Map<string, GlobalSearchHit[]>()

    for (const result of settled) {
      if (result.status === "rejected") {
        this.logger.debug({ error: result.reason, ids }, "project search resolver failed")
        continue
      }

      for (const hit of result.value) {
        const existing = hitsById.get(hit.id) ?? []
        existing.push(hit)
        hitsById.set(hit.id, existing)
      }
    }

    return hitsById
  }
}
