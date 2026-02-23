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

export type GlobalSearchTextProjectResult = {
  projectId: string
  hits: GlobalSearchHit[]
}

export type GlobalSearchTextResult = {
  text: string
  projects: GlobalSearchTextProjectResult[]
}

function normalizeSearchText(text: string): string {
  return text.trim().toLowerCase()
}

function stringIncludesQuery(value: string | undefined, query: string): boolean {
  if (!value) {
    return false
  }

  return value.toLowerCase().includes(query)
}

function matchesCommonObjectMeta(meta: unknown, query: string): boolean {
  const parsed = commonObjectMetaSchema.safeParse(meta)

  if (parsed.success) {
    return (
      stringIncludesQuery(parsed.data.title, query) ||
      stringIncludesQuery(parsed.data.description, query)
    )
  }

  if (meta && typeof meta === "object") {
    const title = "title" in meta && typeof meta.title === "string" ? meta.title : undefined
    const description =
      "description" in meta && typeof meta.description === "string" ? meta.description : undefined

    return stringIncludesQuery(title, query) || stringIncludesQuery(description, query)
  }

  return false
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

type ProjectTextSearchResolver = (
  database: ProjectDatabase,
  text: string,
  logger: Logger,
) => Promise<GlobalSearchHit[]>

const projectTextSearchResolvers: ProjectTextSearchResolver[] = [
  async (database, text, logger) => {
    const operations = await database.operation.findMany({
      select: {
        id: true,
        meta: true,
      },
    })

    const matches = operations.filter(
      operation =>
        stringIncludesQuery(operation.id, text) || matchesCommonObjectMeta(operation.meta, text),
    )

    return createSearchHits("operation", matches, operation => operation.meta, logger)
  },
  async (database, text, logger) => {
    const states = await database.instanceState.findMany({
      select: {
        id: true,
        instanceId: true,
        status: true,
      },
    })

    const matches = states.filter(
      state =>
        stringIncludesQuery(state.id, text) ||
        stringIncludesQuery(state.instanceId, text) ||
        stringIncludesQuery(`${state.status}`, text),
    )

    return createSearchHits(
      "instanceState",
      matches,
      state => ({
        title: state.instanceId,
        description: `${state.status}`,
      }),
      logger,
    )
  },
  async (database, text, logger) => {
    const artifacts = await database.artifact.findMany({
      select: {
        id: true,
        hash: true,
        meta: true,
      },
    })

    const matches = artifacts.filter(
      artifact =>
        stringIncludesQuery(artifact.id, text) ||
        stringIncludesQuery(artifact.hash, text) ||
        matchesCommonObjectMeta(artifact.meta, text),
    )

    return createSearchHits("artifact", matches, artifact => artifact.meta, logger)
  },
  async (database, text, logger) => {
    const pages = await database.page.findMany({
      select: {
        id: true,
        name: true,
        meta: true,
      },
    })

    const matches = pages.filter(
      page =>
        stringIncludesQuery(page.id, text) ||
        stringIncludesQuery(page.name ?? undefined, text) ||
        matchesCommonObjectMeta(page.meta, text),
    )

    return createSearchHits("page", matches, page => page.meta, logger)
  },
  async (database, text, logger) => {
    const terminals = await database.terminal.findMany({
      select: {
        id: true,
        name: true,
        meta: true,
      },
    })

    const matches = terminals.filter(
      terminal =>
        stringIncludesQuery(terminal.id, text) ||
        stringIncludesQuery(terminal.name ?? undefined, text) ||
        matchesCommonObjectMeta(terminal.meta, text),
    )

    return createSearchHits("terminal", matches, terminal => terminal.meta, logger)
  },
  async (database, text, logger) => {
    const sessions = await database.terminalSession.findMany({
      select: {
        id: true,
        terminal: {
          select: {
            name: true,
            meta: true,
          },
        },
      },
    })

    const matches = sessions.filter(
      session =>
        stringIncludesQuery(session.id, text) ||
        stringIncludesQuery(session.terminal.name ?? undefined, text) ||
        matchesCommonObjectMeta(session.terminal.meta, text),
    )

    return createSearchHits(
      "terminalSession",
      matches,
      session => session.terminal.meta,
      logger,
    )
  },
  async (database, text, logger) => {
    const secrets = await database.secret.findMany({
      select: {
        id: true,
        name: true,
        systemName: true,
        meta: true,
      },
    })

    const matches = secrets.filter(
      secret =>
        stringIncludesQuery(secret.id, text) ||
        stringIncludesQuery(secret.name ?? undefined, text) ||
        stringIncludesQuery(secret.systemName ?? undefined, text) ||
        matchesCommonObjectMeta(secret.meta, text),
    )

    return createSearchHits("secret", matches, secret => secret.meta, logger)
  },
  async (database, text, logger) => {
    const accounts = await database.serviceAccount.findMany({
      select: {
        id: true,
        meta: true,
      },
    })

    const matches = accounts.filter(
      account =>
        stringIncludesQuery(account.id, text) || matchesCommonObjectMeta(account.meta, text),
    )

    return createSearchHits("serviceAccount", matches, account => account.meta, logger)
  },
  async (database, text, logger) => {
    const apiKeys = await database.apiKey.findMany({
      select: {
        id: true,
        meta: true,
      },
    })

    const matches = apiKeys.filter(
      apiKey => stringIncludesQuery(apiKey.id, text) || matchesCommonObjectMeta(apiKey.meta, text),
    )

    return createSearchHits("apiKey", matches, apiKey => apiKey.meta, logger)
  },
  async (database, text, logger) => {
    const triggers = await database.trigger.findMany({
      select: {
        id: true,
        name: true,
        meta: true,
      },
    })

    const matches = triggers.filter(
      trigger =>
        stringIncludesQuery(trigger.id, text) ||
        stringIncludesQuery(trigger.name, text) ||
        matchesCommonObjectMeta(trigger.meta, text),
    )

    return createSearchHits("trigger", matches, trigger => trigger.meta, logger)
  },
  async (database, text, logger) => {
    const unlockMethods = await database.unlockMethod.findMany({
      select: {
        id: true,
        type: true,
        recipient: true,
        meta: true,
      },
    })

    const matches = unlockMethods.filter(
      unlockMethod =>
        stringIncludesQuery(unlockMethod.id, text) ||
        stringIncludesQuery(`${unlockMethod.type}`, text) ||
        stringIncludesQuery(unlockMethod.recipient, text) ||
        matchesCommonObjectMeta(unlockMethod.meta, text),
    )

    return createSearchHits(
      "unlockMethod",
      matches,
      unlockMethod => unlockMethod.meta,
      logger,
    )
  },
  async (database, text, logger) => {
    const workers = await database.worker.findMany({
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

    const matches = workers.filter(
      worker =>
        stringIncludesQuery(worker.id, text) ||
        stringIncludesQuery(worker.identity, text) ||
        matchesCommonObjectMeta(worker.versions[0]?.meta, text),
    )

    return createSearchHits("worker", matches, worker => worker.versions[0]?.meta, logger)
  },
  async (database, text, logger) => {
    const versions = await database.workerVersion.findMany({
      select: {
        id: true,
        digest: true,
        meta: true,
      },
    })

    const matches = versions.filter(
      version =>
        stringIncludesQuery(version.id, text) ||
        stringIncludesQuery(version.digest, text) ||
        matchesCommonObjectMeta(version.meta, text),
    )

    return createSearchHits("workerVersion", matches, version => version.meta, logger)
  },
  async (database, text, logger) => {
    const snapshots = await database.entitySnapshot.findMany({
      select: {
        id: true,
        entityId: true,
        meta: true,
      },
    })

    const matches = snapshots.filter(
      snapshot =>
        stringIncludesQuery(snapshot.id, text) ||
        stringIncludesQuery(snapshot.entityId, text) ||
        matchesCommonObjectMeta(snapshot.meta, text),
    )

    return createSearchHits("entitySnapshot", matches, snapshot => snapshot.meta, logger)
  },
  async (database, text, logger) => {
    const entities = await database.entity.findMany({
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

    const matches = entities.filter(
      entity =>
        stringIncludesQuery(entity.id, text) ||
        stringIncludesQuery(entity.type, text) ||
        stringIncludesQuery(entity.identity, text) ||
        matchesCommonObjectMeta(entity.snapshots[0]?.meta, text),
    )

    return createSearchHits("entity", matches, entity => entity.snapshots[0]?.meta, logger)
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

  /**
   * Searches for objects across all unlocked projects by a free-form text.
   *
   * It queries a curated set of collections within each unlocked project.
   * Locked projects are skipped because their databases cannot be queried.
   *
   * @param text The text query to search for.
   */
  async searchByText(text: string): Promise<GlobalSearchTextResult> {
    const normalizedText = normalizeSearchText(text)

    if (normalizedText.length === 0) {
      return { text, projects: [] }
    }

    const projects = await this.database.backend.project.findMany({
      select: {
        id: true,
      },
    })

    const results: GlobalSearchTextProjectResult[] = []

    for (const project of projects) {
      const isUnlocked = await this.projectUnlockBackend.checkProjectUnlocked(project.id)

      if (!isUnlocked) {
        continue
      }

      try {
        const projectDatabase = await this.database.forProject(project.id)
        const hits = await this.searchInUnlockedProjectByText(projectDatabase, normalizedText)

        if (hits.length === 0) {
          continue
        }

        results.push({ projectId: project.id, hits })
      } catch (error) {
        this.logger.error(
          { error, projectId: project.id },
          'failed to search by text in unlocked project "%s"',
          project.id,
        )
      }
    }

    return { text, projects: results }
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

  private async searchInUnlockedProjectByText(
    database: ProjectDatabase,
    text: string,
  ): Promise<GlobalSearchHit[]> {
    const settled = await Promise.allSettled(
      projectTextSearchResolvers.map(async r => await r(database, text, this.logger)),
    )

    const hitsByKey = new Map<string, GlobalSearchHit>()

    for (const result of settled) {
      if (result.status === "rejected") {
        this.logger.debug({ error: result.reason, text }, "project text search resolver failed")
        continue
      }

      for (const hit of result.value) {
        hitsByKey.set(`${hit.kind}:${hit.id}`, hit)
      }
    }

    return Array.from(hitsByKey.values())
  }
}
