import type {
  AuthorizationSubject,
  BackendRequestContext,
  ProjectRequestContext,
  ReadonlyDeep,
  ResolvedPermissions,
} from "../common"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "../shared"
import { backendPermissionGroups, projectPermissionGroups } from "../shared"

const defaultSubject: AuthorizationSubject = {
  type: "user",
  userId: "test-user",
  groupIds: [],
}

export function createBackendRequestContext(
  permissions: ResolvedPermissions<BackendPermission, BackendPermissionRestriction> = new Map(),
  subject: AuthorizationSubject = defaultSubject,
): BackendRequestContext {
  return { realm: "backend", subject, permissions }
}

export function createProjectRequestContext(
  projectId: string,
  permissions: ResolvedPermissions<ProjectPermission, ProjectPermissionRestriction> = new Map(),
  subject: AuthorizationSubject = defaultSubject,
): ProjectRequestContext {
  return { realm: "project", projectId, subject, permissions }
}

export function grantBackendPermission(
  permission: BackendPermission,
  restrictions: readonly ReadonlyDeep<BackendPermissionRestriction>[] = [],
): ResolvedPermissions<BackendPermission, BackendPermissionRestriction> {
  return new Map([[permission, [{ restrictions }]]])
}

export function grantBackendPermissions(
  permissions: readonly BackendPermission[],
): ResolvedPermissions<BackendPermission, BackendPermissionRestriction> {
  return new Map(permissions.map(permission => [permission, [{ restrictions: [] }]]))
}

export function grantProjectPermission(
  permission: ProjectPermission,
  restrictions: readonly ReadonlyDeep<ProjectPermissionRestriction>[] = [],
): ResolvedPermissions<ProjectPermission, ProjectPermissionRestriction> {
  return new Map([[permission, [{ restrictions }]]])
}

export function grantProjectPermissions(
  permissions: readonly ProjectPermission[],
): ResolvedPermissions<ProjectPermission, ProjectPermissionRestriction> {
  return new Map(permissions.map(permission => [permission, [{ restrictions: [] }]]))
}

/**
 * Creates a backend request context with every backend permission without restrictions.
 *
 * Use this context in tests that exercise business logic rather than authorization.
 */
export function adminBackendContext(
  subject: AuthorizationSubject = defaultSubject,
): BackendRequestContext {
  const permissions = backendPermissionGroups.flatMap(group =>
    group.permissions.map(permission => permission.name),
  )

  return createBackendRequestContext(grantBackendPermissions(permissions), subject)
}

/**
 * Creates a project request context with every project permission without restrictions.
 *
 * Use this context in tests that exercise business logic rather than authorization.
 */
export function adminProjectContext(
  projectId: string,
  subject: AuthorizationSubject = defaultSubject,
): ProjectRequestContext {
  const permissions = projectPermissionGroups.flatMap(group =>
    group.permissions.map(permission => permission.name),
  )

  return createProjectRequestContext(projectId, grantProjectPermissions(permissions), subject)
}
