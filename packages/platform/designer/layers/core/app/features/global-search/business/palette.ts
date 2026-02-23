import type {
  GlobalSearchHit,
  GlobalSearchObjectKind,
  GlobalSearchProjectResult,
  GlobalSearchResult,
  GlobalSearchTextProjectResult,
  GlobalSearchTextResult,
} from "@highstate/backend"

export type GlobalSearchUnlockState = "locked" | "unlocked"

export type GlobalSearchPaletteItem =
  | {
      type: "hit"
      projectId: string
      unlockState: "unlocked"
      hit: GlobalSearchHit
    }
  | {
      type: "lockedId"
      projectId: string
      unlockState: "locked"
      id: string
    }

export type GlobalSearchPaletteGroup = {
  projectId: string
  projectTitle: string
  unlockState: GlobalSearchUnlockState
  items: GlobalSearchPaletteItem[]
}

export type GlobalSearchQueryPlan =
  | { type: "empty" }
  | { type: "id"; ids: string[] }
  | { type: "text"; text: string }

const cuid2Regex = /^c[a-z0-9]{23}$/

export function parseGlobalSearchQuery(text: string): GlobalSearchQueryPlan {
  const tokens = text.trim().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return { type: "empty" }
  }

  const ids = tokens.filter(token => cuid2Regex.test(token))

  if (ids.length > 0 && ids.length === tokens.length) {
    return { type: "id", ids: ids.slice(0, 50) }
  }

  return { type: "text", text }
}

export function getSearchHitFallbackIcon(kind: GlobalSearchObjectKind): string {
  switch (kind) {
    case "apiKey":
      return "mdi-key"
    case "artifact":
      return "mdi-file"
    case "entity":
      return "mdi-database-outline"
    case "instanceState":
      return "mdi-cube-outline"
    case "operation":
      return "mdi-history"
    case "page":
      return "mdi-file-document-outline"
    case "secret":
      return "mdi-lock"
    case "serviceAccount":
      return "mdi-account"
    case "terminal":
      return "mdi-console"
    case "terminalSession":
      return "mdi-console"
    case "trigger":
      return "mdi-flash"
    case "unlockMethod":
      return "mdi-lock-check"
    case "worker":
      return "mdi-robot"
    case "workerVersion":
      return "mdi-source-branch"
    case "entitySnapshot":
      return "mdi-file-search-outline"
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function getPaletteItemKey(item: GlobalSearchPaletteItem): string {
  if (item.type === "hit") {
    return `${item.hit.kind}:${item.hit.id}`
  }

  return `lockedId:${item.id}`
}

export function toGroupsFromTextResult(
  result: GlobalSearchTextResult,
  options: { resolveProjectTitle: (projectId: string) => string },
): GlobalSearchPaletteGroup[] {
  const mapped = result.projects
    .map((project: GlobalSearchTextProjectResult) => {
      const items: GlobalSearchPaletteItem[] = project.hits
        .map(hit => ({
          type: "hit",
          projectId: project.projectId,
          unlockState: "unlocked",
          hit,
        }))

      if (items.length === 0) {
        return null
      }

      return {
        projectId: project.projectId,
        projectTitle: options.resolveProjectTitle(project.projectId),
        unlockState: "unlocked" as const,
        items,
      }
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)

  return mapped
}

export function toGroupsFromIdsResult(
  results: GlobalSearchResult[],
  options: { resolveProjectTitle: (projectId: string) => string },
): GlobalSearchPaletteGroup[] {
  const itemsByProjectId = new Map<string, GlobalSearchPaletteItem[]>()
  const unlockStateByProjectId = new Map<string, GlobalSearchUnlockState>()

  for (const result of results) {
    for (const projectResult of result.projects) {
      unlockStateByProjectId.set(projectResult.projectId, projectResult.unlockState)

      const existing = itemsByProjectId.get(projectResult.projectId) ?? []

      if (projectResult.unlockState === "locked") {
        existing.push({
          type: "lockedId",
          projectId: projectResult.projectId,
          unlockState: "locked",
          id: result.id,
        })
      } else {
        for (const hit of projectResult.hits) {
          existing.push({
            type: "hit",
            projectId: projectResult.projectId,
            unlockState: "unlocked",
            hit,
          })
        }

        if (projectResult.hits.length === 0) {
          existing.push({
            type: "lockedId",
            projectId: projectResult.projectId,
            unlockState: "locked",
            id: result.id,
          })
        }
      }

      itemsByProjectId.set(projectResult.projectId, existing)
    }
  }

  const groups: GlobalSearchPaletteGroup[] = []

  for (const [projectId, items] of itemsByProjectId.entries()) {
    const unlockState = unlockStateByProjectId.get(projectId) ?? "locked"

    const dedupedItems: GlobalSearchPaletteItem[] = []
    const seen = new Set<string>()

    for (const item of items) {
      const key = getPaletteItemKey(item)

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      dedupedItems.push(item)
    }

    groups.push({
      projectId,
      projectTitle: options.resolveProjectTitle(projectId),
      unlockState,
      items: dedupedItems,
    })
  }

  groups.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle))

  return groups
}

export type GlobalSearchNavigateTarget = {
  name: string
  params: Record<string, string>
}

const settingsRouteByKind: Record<
  Exclude<GlobalSearchObjectKind, "terminalSession">,
  {
    name: string
    paramKey: string
  }
> = {
  apiKey: { name: "settings.api-key-details", paramKey: "apiKeyId" },
  artifact: { name: "settings.artifact-details", paramKey: "artifactId" },
  entity: { name: "settings.entity-details", paramKey: "entityId" },
  entitySnapshot: { name: "settings.entity-snapshot-details", paramKey: "snapshotId" },
  instanceState: { name: "settings.instance-details", paramKey: "stateId" },
  operation: { name: "settings.operation-details", paramKey: "operationId" },
  page: { name: "settings.page-details", paramKey: "pageId" },
  secret: { name: "settings.secret-details", paramKey: "secretId" },
  serviceAccount: { name: "settings.service-account-details", paramKey: "serviceAccountId" },
  terminal: { name: "settings.terminal-details", paramKey: "terminalId" },
  trigger: { name: "settings.trigger-details", paramKey: "triggerId" },
  unlockMethod: { name: "settings.unlock-method-details", paramKey: "unlockMethodId" },
  worker: { name: "settings.worker-details", paramKey: "workerId" },
  workerVersion: { name: "settings.worker-version-details", paramKey: "versionId" },
}

export function getNavigateTargetForPaletteItem(
  item: GlobalSearchPaletteItem,
): GlobalSearchNavigateTarget | null {
  if (item.type === "lockedId") {
    return {
      name: "project",
      params: {
        projectId: item.projectId,
      },
    }
  }

  const kind = item.hit.kind

  if (kind === "terminalSession") {
    return {
      name: "terminal-session",
      params: {
        projectId: item.projectId,
        sessionId: item.hit.id,
      },
    }
  }

  const route = settingsRouteByKind[kind]

  return {
    name: route.name,
    params: {
      projectId: item.projectId,
      [route.paramKey]: item.hit.id,
    },
  }
}

export function isUnlockedProjectResult(
  result: GlobalSearchProjectResult,
): result is Extract<GlobalSearchProjectResult, { unlockState: "unlocked" }> {
  return result.unlockState === "unlocked"
}
