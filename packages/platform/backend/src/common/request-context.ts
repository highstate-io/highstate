import type { InstanceId } from "@highstate/contract"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "../shared"
import { PermissionDeniedError } from "../shared"

export type AuthorizationSubject =
  | {
      type: "service-account"
      serviceAccountId: string
      apiKeyId?: string
      workerId?: string
    }
  | {
      type: "user"
      userId: string
      groupIds: string[]
    }

export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T

export type ResolvedPermissionGrant<TRestriction> = {
  restrictions: readonly ReadonlyDeep<TRestriction>[]
}

export type ResolvedPermissionRestriction<TRestriction> = ReadonlyDeep<TRestriction>

export type ProjectPermissionRule = {
  permissions: readonly ProjectPermission[]
  restrictions?: readonly ResolvedPermissionRestriction<ProjectPermissionRestriction>[]
}

export type BackendPermissionRule = {
  permissions: readonly BackendPermission[]
  restrictions?: readonly ResolvedPermissionRestriction<BackendPermissionRestriction>[]
}

export type ResolvedPermissions<TPermission extends string, TRestriction> = ReadonlyMap<
  TPermission,
  readonly ResolvedPermissionGrant<TRestriction>[]
>

export type ProjectRequestContext = {
  realm: "project"
  projectId: string
  subject: AuthorizationSubject
  permissions: ResolvedPermissions<ProjectPermission, ProjectPermissionRestriction>
}

export type BackendRequestContext = {
  realm: "backend"
  subject: AuthorizationSubject
  permissions: ResolvedPermissions<BackendPermission, BackendPermissionRestriction>
}

export type UserAuthorizationSubject = Extract<AuthorizationSubject, { type: "user" }>

export type UserProjectRequestContext = Omit<ProjectRequestContext, "subject"> & {
  subject: UserAuthorizationSubject
}

export type UserBackendRequestContext = Omit<BackendRequestContext, "subject"> & {
  subject: UserAuthorizationSubject
}

export type ProjectPermissionTarget = {
  resourceId?: string
  instanceId?: InstanceId
  ancestorInstanceIds?: readonly InstanceId[]
  ownerServiceAccountId?: string
  workerId?: string
}

export type BackendPermissionTarget = {
  resourceId?: string
  projectId?: string
  projectSpaceId?: string
  ancestorProjectSpaceIds?: readonly string[]
}

export function hasProjectPermission(
  context: ProjectRequestContext,
  permission: ProjectPermission,
  target?: ProjectPermissionTarget,
): boolean {
  const grants = context.permissions.get(permission) ?? []

  return grants.some(grant =>
    grant.restrictions.every(restriction =>
      matchesProjectRestriction(context, restriction, target),
    ),
  )
}

export function requireProjectPermission(
  context: ProjectRequestContext,
  permission: ProjectPermission,
  target?: ProjectPermissionTarget,
): void {
  if (!hasProjectPermission(context, permission, target)) {
    throw new PermissionDeniedError(permission)
  }
}

export function hasProjectPermissionSubset(
  context: ProjectRequestContext,
  permission: ProjectPermission,
  restrictions: readonly ResolvedPermissionRestriction<ProjectPermissionRestriction>[],
): boolean {
  return (context.permissions.get(permission) ?? []).some(grant =>
    isRestrictionSubset(grant.restrictions, restrictions),
  )
}

export function hasBackendPermissionSubset(
  context: BackendRequestContext,
  permission: BackendPermission,
  restrictions: readonly ResolvedPermissionRestriction<BackendPermissionRestriction>[],
): boolean {
  return (context.permissions.get(permission) ?? []).some(grant =>
    isRestrictionSubset(grant.restrictions, restrictions),
  )
}

export function hasProjectPermissionRulesSubset(
  context: ProjectRequestContext,
  rules: readonly ProjectPermissionRule[],
): boolean {
  return rules.every(rule =>
    rule.permissions.every(permission =>
      hasProjectPermissionSubset(context, permission, rule.restrictions ?? []),
    ),
  )
}

export function hasBackendPermissionRulesSubset(
  context: BackendRequestContext,
  rules: readonly BackendPermissionRule[],
): boolean {
  return rules.every(rule =>
    rule.permissions.every(permission =>
      hasBackendPermissionSubset(context, permission, rule.restrictions ?? []),
    ),
  )
}

function isRestrictionSubset(
  granted: readonly ReadonlyProjectOrBackendRestriction[],
  target: readonly ReadonlyProjectOrBackendRestriction[],
): boolean {
  if (granted.length === 0) {
    return true
  }

  if (target.length === 0) {
    return false
  }

  return (
    granted.every(grant => target.some(restriction => restriction.type === grant.type)) &&
    target.every(targetRestriction => {
      const matchingGrant = granted.find(restriction => restriction.type === targetRestriction.type)
      return (
        matchingGrant !== undefined && isRestrictionValueSubset(matchingGrant, targetRestriction)
      )
    })
  )
}

function isRestrictionValueSubset(
  granted: ReadonlyProjectOrBackendRestriction,
  target: ReadonlyProjectOrBackendRestriction,
): boolean {
  if (granted.type !== target.type) {
    return false
  }

  switch (granted.type) {
    case "resources":
      return (
        target.type === "resources" &&
        target.resourceIds.every(id => granted.resourceIds.includes(id))
      )
    case "projects":
      return (
        target.type === "projects" && target.projectIds.every(id => granted.projectIds.includes(id))
      )
    case "owners":
      return (
        target.type === "owners" &&
        target.serviceAccountIds.every(id => granted.serviceAccountIds.includes(id))
      )
    case "workers":
      return (
        target.type === "workers" && target.workerIds.every(id => granted.workerIds.includes(id))
      )
    case "instances":
      return (
        target.type === "instances" &&
        (!target.recursive || granted.recursive) &&
        target.instanceIds.every(id => granted.instanceIds.includes(id))
      )
    case "project-spaces":
    case "projects-in-spaces":
      return (
        target.type === granted.type &&
        (!target.recursive || granted.recursive) &&
        target.projectSpaceIds.every(id => granted.projectSpaceIds.includes(id))
      )
    case "self":
      return true
  }

  return false
}

type ReadonlyProjectOrBackendRestriction =
  | {
      readonly type: "resources"
      readonly resourceIds: readonly string[]
    }
  | {
      readonly type: "projects"
      readonly projectIds: readonly string[]
    }
  | {
      readonly type: "project-spaces" | "projects-in-spaces"
      readonly projectSpaceIds: readonly string[]
      readonly recursive: boolean
    }
  | {
      readonly type: "instances"
      readonly instanceIds: readonly InstanceId[]
      readonly recursive: boolean
    }
  | {
      readonly type: "owners"
      readonly serviceAccountIds: readonly string[]
    }
  | {
      readonly type: "workers"
      readonly workerIds: readonly string[]
    }
  | { readonly type: "self" }

export function hasBackendPermission(
  context: BackendRequestContext,
  permission: BackendPermission,
  target?: BackendPermissionTarget,
): boolean {
  const grants = context.permissions.get(permission) ?? []

  return grants.some(grant =>
    grant.restrictions.every(restriction => matchesBackendRestriction(restriction, target)),
  )
}

export function requireBackendPermission(
  context: BackendRequestContext,
  permission: BackendPermission,
  target?: BackendPermissionTarget,
): void {
  if (!hasBackendPermission(context, permission, target)) {
    throw new PermissionDeniedError(permission)
  }
}

function matchesBackendRestriction(
  restriction: ResolvedPermissionRestriction<BackendPermissionRestriction>,
  target?: BackendPermissionTarget,
): boolean {
  switch (restriction.type) {
    case "resources":
      return target?.resourceId !== undefined && restriction.resourceIds.includes(target.resourceId)
    case "projects":
      return target?.projectId !== undefined && restriction.projectIds.includes(target.projectId)
    case "project-spaces":
      if (
        target?.projectSpaceId !== undefined &&
        restriction.projectSpaceIds.includes(target.projectSpaceId)
      ) {
        return true
      }

      return (
        restriction.recursive &&
        target?.ancestorProjectSpaceIds?.some(projectSpaceId =>
          restriction.projectSpaceIds.includes(projectSpaceId),
        ) === true
      )
    case "projects-in-spaces":
      if (
        target?.projectSpaceId !== undefined &&
        restriction.projectSpaceIds.includes(target.projectSpaceId)
      ) {
        return true
      }

      return (
        restriction.recursive &&
        target?.ancestorProjectSpaceIds?.some(projectSpaceId =>
          restriction.projectSpaceIds.includes(projectSpaceId),
        ) === true
      )
  }
}

function matchesProjectRestriction(
  context: ProjectRequestContext,
  restriction: ResolvedPermissionRestriction<ProjectPermissionRestriction>,
  target?: ProjectPermissionTarget,
): boolean {
  switch (restriction.type) {
    case "resources":
      return target?.resourceId !== undefined && restriction.resourceIds.includes(target.resourceId)
    case "instances":
      if (target?.instanceId && restriction.instanceIds.includes(target.instanceId)) {
        return true
      }

      return (
        restriction.recursive &&
        target?.ancestorInstanceIds?.some(instanceId =>
          restriction.instanceIds.includes(instanceId),
        ) === true
      )
    case "owners":
      return (
        target?.ownerServiceAccountId !== undefined &&
        restriction.serviceAccountIds.includes(target.ownerServiceAccountId)
      )
    case "self":
      return (
        context.subject.type === "service-account" &&
        target?.ownerServiceAccountId === context.subject.serviceAccountId
      )
    case "workers":
      return target?.workerId !== undefined && restriction.workerIds.includes(target.workerId)
  }
}
