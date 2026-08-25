import type { DatabaseManager } from "../database"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "../shared"
import type {
  BackendRequestContext,
  ProjectRequestContext,
  ResolvedPermissionRestriction,
} from "./request-context"
import { PermissionDeniedError } from "../shared"

type InstanceScope = {
  instanceIds: readonly string[]
  stateIds: readonly string[]
}

export type ProjectAuthorizationTarget<TWhere> = {
  resources?: (resourceIds: readonly string[]) => TWhere
  instances?: (scope: InstanceScope) => TWhere
  owners?: (serviceAccountIds: readonly string[]) => TWhere
  self?: (serviceAccountId: string) => TWhere
  workers?: (workerIds: readonly string[]) => TWhere
}

export type BackendAuthorizationTarget<TWhere> = {
  resources?: (resourceIds: readonly string[]) => TWhere
  projects?: (projectIds: readonly string[]) => TWhere
  projectSpaces?: (projectSpaceIds: readonly string[]) => TWhere
  projectsInSpaces?: (projectSpaceIds: readonly string[]) => TWhere
}

export type ProjectAuthorizationWhereOptions<TWhere> = {
  database: DatabaseManager
  context: ProjectRequestContext
  permission: ProjectPermission
  target: ProjectAuthorizationTarget<TWhere>
}

export type BackendAuthorizationWhereOptions<TWhere> = {
  database: DatabaseManager
  context: BackendRequestContext
  permission: BackendPermission
  target: BackendAuthorizationTarget<TWhere>
}

/**
 * Compiles resolved project permission grants into a database predicate.
 *
 * Instance hierarchies are resolved in memory when recursive restrictions require them.
 *
 * @param options The request context and model-specific authorization mapping.
 * @returns A predicate that authorizes collection rows in the database.
 */
export async function buildProjectAuthorizationWhere<TWhere>(
  options: ProjectAuthorizationWhereOptions<TWhere>,
): Promise<TWhere> {
  const { database, context, permission, target } = options
  const grants = context.permissions.get(permission) ?? []
  if (grants.length === 0) {
    throw new PermissionDeniedError(permission)
  }

  if (grants.some(grant => grant.restrictions.length === 0)) {
    return {} as TWhere
  }

  const restrictions = grants.flatMap(grant => grant.restrictions)
  const needsInstances = restrictions.some(restriction => restriction.type === "instances")
  const instanceScopes = needsInstances
    ? await resolveInstanceScopes(database, context.projectId, restrictions)
    : new Map<ResolvedPermissionRestriction<ProjectPermissionRestriction>, InstanceScope>()
  const grantPredicates = grants.map(grant => {
    const predicates = grant.restrictions.map(restriction =>
      buildProjectRestrictionWhere(context, restriction, target, instanceScopes),
    )

    return { AND: predicates } as TWhere
  })

  return { OR: grantPredicates } as TWhere
}

/**
 * Compiles resolved backend permission grants into a database predicate.
 *
 * Project-space hierarchies are resolved in memory when recursive restrictions require them.
 *
 * @param options The request context and model-specific authorization mapping.
 * @returns A predicate that authorizes collection rows in the database.
 */
export async function buildBackendAuthorizationWhere<TWhere>(
  options: BackendAuthorizationWhereOptions<TWhere>,
): Promise<TWhere> {
  const { database, context, permission, target } = options
  const grants = context.permissions.get(permission) ?? []
  if (grants.length === 0) {
    throw new PermissionDeniedError(permission)
  }

  if (grants.some(grant => grant.restrictions.length === 0)) {
    return {} as TWhere
  }

  const restrictions = grants.flatMap(grant => grant.restrictions)
  const spaceScopes = await resolveProjectSpaceScopes(database, restrictions)
  const grantPredicates = grants.map(grant => {
    const predicates = grant.restrictions.map(restriction =>
      buildBackendRestrictionWhere(restriction, target, spaceScopes),
    )

    return { AND: predicates } as TWhere
  })

  return { OR: grantPredicates } as TWhere
}

function buildProjectRestrictionWhere<TWhere>(
  context: ProjectRequestContext,
  restriction: ResolvedPermissionRestriction<ProjectPermissionRestriction>,
  target: ProjectAuthorizationTarget<TWhere>,
  instanceScopes: ReadonlyMap<
    ResolvedPermissionRestriction<ProjectPermissionRestriction>,
    InstanceScope
  >,
): TWhere {
  switch (restriction.type) {
    case "resources":
      return target.resources?.(restriction.resourceIds) ?? impossibleWhere<TWhere>()
    case "instances":
      if ((instanceScopes.get(restriction)?.stateIds.length ?? 0) === 0) {
        return impossibleWhere<TWhere>()
      }

      return (
        target.instances?.(instanceScopes.get(restriction) ?? emptyInstanceScope) ??
        impossibleWhere<TWhere>()
      )
    case "owners":
      return target.owners?.(restriction.serviceAccountIds) ?? impossibleWhere<TWhere>()
    case "self":
      return context.subject.type === "service-account"
        ? (target.self?.(context.subject.serviceAccountId) ?? impossibleWhere<TWhere>())
        : impossibleWhere<TWhere>()
    case "workers":
      return target.workers?.(restriction.workerIds) ?? impossibleWhere<TWhere>()
  }
}

function buildBackendRestrictionWhere<TWhere>(
  restriction: ResolvedPermissionRestriction<BackendPermissionRestriction>,
  target: BackendAuthorizationTarget<TWhere>,
  spaceScopes: ReadonlyMap<
    ResolvedPermissionRestriction<BackendPermissionRestriction>,
    readonly string[]
  >,
): TWhere {
  switch (restriction.type) {
    case "resources":
      return target.resources?.(restriction.resourceIds) ?? impossibleWhere<TWhere>()
    case "projects":
      return target.projects?.(restriction.projectIds) ?? impossibleWhere<TWhere>()
    case "project-spaces":
      if ((spaceScopes.get(restriction)?.length ?? 0) === 0) {
        return impossibleWhere<TWhere>()
      }

      return target.projectSpaces?.(spaceScopes.get(restriction) ?? []) ?? impossibleWhere<TWhere>()
    case "projects-in-spaces":
      if ((spaceScopes.get(restriction)?.length ?? 0) === 0) {
        return impossibleWhere<TWhere>()
      }

      return (
        target.projectsInSpaces?.(spaceScopes.get(restriction) ?? []) ?? impossibleWhere<TWhere>()
      )
  }
}

function impossibleWhere<TWhere>(): TWhere {
  return { OR: [] } as TWhere
}

const emptyInstanceScope: InstanceScope = { instanceIds: [], stateIds: [] }

async function resolveInstanceScopes(
  database: DatabaseManager,
  projectId: string,
  restrictions: readonly ResolvedPermissionRestriction<ProjectPermissionRestriction>[],
): Promise<
  ReadonlyMap<ResolvedPermissionRestriction<ProjectPermissionRestriction>, InstanceScope>
> {
  const projectDatabase = await database.forProject(projectId)
  const states = await projectDatabase.instanceState.findMany({
    select: { id: true, instanceId: true, parentId: true },
  })
  const children = buildChildren(states)
  const byInstanceId = new Map(states.map(state => [state.instanceId, state]))
  const result = new Map<
    ResolvedPermissionRestriction<ProjectPermissionRestriction>,
    InstanceScope
  >()

  for (const restriction of restrictions) {
    if (restriction.type !== "instances") {
      continue
    }

    const stateIds = new Set<string>()
    for (const instanceId of restriction.instanceIds) {
      const state = byInstanceId.get(instanceId)
      if (!state) {
        continue
      }

      stateIds.add(state.id)
      if (restriction.recursive) {
        addDescendants(state.id, children, stateIds)
      }
    }

    result.set(restriction, {
      stateIds: [...stateIds],
      instanceIds: states.filter(state => stateIds.has(state.id)).map(state => state.instanceId),
    })
  }

  return result
}

async function resolveProjectSpaceScopes(
  database: DatabaseManager,
  restrictions: readonly ResolvedPermissionRestriction<BackendPermissionRestriction>[],
): Promise<
  ReadonlyMap<ResolvedPermissionRestriction<BackendPermissionRestriction>, readonly string[]>
> {
  const hierarchyRestrictions = restrictions.filter(
    restriction =>
      restriction.type === "project-spaces" || restriction.type === "projects-in-spaces",
  )
  if (hierarchyRestrictions.length === 0) {
    return new Map()
  }

  const spaces = await database.backend.projectSpace.findMany({
    select: { id: true, parentId: true },
  })
  const children = buildChildren(spaces)
  const existingIds = new Set(spaces.map(space => space.id))
  const result = new Map<
    ResolvedPermissionRestriction<BackendPermissionRestriction>,
    readonly string[]
  >()

  for (const restriction of hierarchyRestrictions) {
    const spaceIds = new Set(restriction.projectSpaceIds.filter(id => existingIds.has(id)))
    if (restriction.recursive) {
      for (const spaceId of [...spaceIds]) {
        addDescendants(spaceId, children, spaceIds)
      }
    }

    result.set(restriction, [...spaceIds])
  }

  return result
}

function buildChildren<TNode extends { id: string; parentId: string | null }>(
  nodes: readonly TNode[],
): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) {
      continue
    }

    const childIds = children.get(node.parentId) ?? []
    childIds.push(node.id)
    children.set(node.parentId, childIds)
  }

  return children
}

function addDescendants(
  rootId: string,
  children: ReadonlyMap<string, readonly string[]>,
  result: Set<string>,
): void {
  const pending = [...(children.get(rootId) ?? [])]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id || result.has(id)) {
      continue
    }

    result.add(id)
    pending.push(...(children.get(id) ?? []))
  }
}
