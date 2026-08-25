import type {
  ApiKey,
  BackendApiKey,
  BackendRequestContext,
  ProjectRequestContext,
  ResolvedPermissionGrant,
  ResolvedPermissionRestriction,
  ResolvedPermissions,
  Services,
} from "@highstate/backend"
import type {
  BackendPermission,
  BackendPermissionRestriction,
  ProjectPermission,
  ProjectPermissionRestriction,
} from "@highstate/backend/shared"
import { Code, type HandlerContext } from "@connectrpc/connect"
import { ProjectLockedError, ProjectNotFoundError } from "@highstate/backend/shared"
import { createApiError } from "./api-error"
import { parseBearerToken } from "./authorization-header"

type ServiceAccountSubject = Extract<
  ProjectRequestContext["subject"],
  { type: "service-account" }
> & { apiKeyId: string }

type BackendAuthorizationContext = Omit<BackendRequestContext, "subject"> & {
  subject: ServiceAccountSubject
}

type ProjectAuthorizationContext = Omit<ProjectRequestContext, "subject"> & {
  subject: ServiceAccountSubject
}

export async function authenticateBackend(
  services: Services,
  context: HandlerContext,
): Promise<BackendAuthorizationContext> {
  const token = getBearerToken(context)
  const apiKey = await services.apiKeyService.getBackendApiKeyByToken(token)
  const roleBindings = await services.database.backend.serviceAccountBackendRoleBinding.findMany({
    where: { serviceAccountId: apiKey.serviceAccountId },
    include: { role: { select: { rules: true } } },
  })

  return {
    realm: "backend",
    subject: {
      type: "service-account",
      serviceAccountId: apiKey.serviceAccountId,
      apiKeyId: apiKey.id,
    },
    permissions: resolveBackendPermissions(
      roleBindings.flatMap(binding =>
        binding.role.rules.map(rule => ({
          permissions: rule.permissions,
          restrictions: rule.restrictions ?? [],
        })),
      ),
      apiKey.restrictionRules,
    ),
  }
}

export async function authenticateProject(
  services: Services,
  request: { projectId: string },
  context: HandlerContext,
): Promise<ProjectAuthorizationContext> {
  const projectId = request.projectId
  if (!projectId) {
    throw createApiError({
      message: "No project ID provided",
      code: Code.InvalidArgument,
      reason: "PROJECT_ID_REQUIRED",
      fieldViolations: [
        {
          field: "project_id",
          reason: "REQUIRED",
          description: "The project ID is required",
        },
      ],
    })
  }

  const project = await services.database.backend.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })

  if (!project) {
    throw new ProjectNotFoundError(projectId)
  }

  if (!(await services.projectUnlockService.checkProjectUnlocked(projectId))) {
    throw new ProjectLockedError(projectId)
  }

  const token = getBearerToken(context)
  const apiKey = await services.apiKeyService.getProjectCredentialByToken(projectId, token)
  const projectDatabase = await services.database.forProject(projectId)
  const roleBindings = await projectDatabase.serviceAccountRoleBinding.findMany({
    where: { serviceAccountId: apiKey.serviceAccountId },
    include: { role: { select: { rules: true } } },
  })

  return {
    realm: "project",
    projectId,
    subject: {
      type: "service-account",
      serviceAccountId: apiKey.serviceAccountId,
      apiKeyId: apiKey.id,
    },
    permissions: resolveProjectPermissions(
      roleBindings.flatMap(binding =>
        binding.role.rules.map(rule => ({
          permissions: rule.permissions,
          restrictions: rule.restrictions ?? [],
        })),
      ),
      apiKey.restrictionRules,
    ),
  }
}

function getBearerToken(context: HandlerContext): string {
  return parseBearerToken(context.requestHeader.get("authorization"))
}

function resolveBackendPermissions(
  grants: readonly {
    permissions: readonly BackendPermission[]
    restrictions: readonly BackendPermissionRestriction[]
  }[],
  restrictions: BackendApiKey["restrictionRules"],
): ResolvedPermissions<BackendPermission, BackendPermissionRestriction> {
  return resolvePermissions(grants, restrictions)
}

function resolveProjectPermissions(
  grants: readonly {
    permissions: readonly ProjectPermission[]
    restrictions: readonly ProjectPermissionRestriction[]
  }[],
  restrictions: ApiKey["restrictionRules"],
): ResolvedPermissions<ProjectPermission, ProjectPermissionRestriction> {
  return resolvePermissions(grants, restrictions)
}

function resolvePermissions<TPermission extends string, TRestriction>(
  grants: readonly {
    permissions: readonly TPermission[]
    restrictions: readonly ResolvedPermissionRestriction<TRestriction>[]
  }[],
  restrictions: readonly {
    permissions: readonly TPermission[]
    restrictions?: readonly ResolvedPermissionRestriction<TRestriction>[]
  }[],
): ResolvedPermissions<TPermission, TRestriction> {
  const restrictionByPermission = new Map(
    restrictions.flatMap(rule =>
      rule.permissions.map(permission => [permission, rule.restrictions ?? []] as const),
    ),
  )
  const permissions = new Map<TPermission, ResolvedPermissionGrant<TRestriction>[]>()
  for (const grant of grants) {
    for (const permission of grant.permissions) {
      const keyRestrictions = restrictionByPermission.get(permission)
      if (restrictions.length > 0 && !keyRestrictions) {
        continue
      }

      const permissionGrants = permissions.get(permission) ?? []
      permissionGrants.push({ restrictions: [...grant.restrictions, ...(keyRestrictions ?? [])] })
      permissions.set(permission, permissionGrants)
    }
  }

  return permissions
}
