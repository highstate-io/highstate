import type {
  BackendRequestContext,
  ProjectRequestContext,
  ResolvedPermissionGrant,
  ResolvedPermissions,
  UserBackendRequestContext,
  UserProjectRequestContext,
} from "../common"
import type { DatabaseManager } from "../database"
import { z } from "@highstate/contract"
import {
  hasBackendPermissionRulesSubset,
  hasProjectPermissionRulesSubset,
  requireBackendPermission,
  requireProjectPermission,
} from "../common"
import {
  backendPermissionGroups,
  backendRoleRulesSchema,
  projectPermissionGroups,
  projectRoleRulesSchema,
  userMetaSchema,
  userTypeSchema,
} from "../shared"

export const designerIdentitySchema = z.object({
  id: z.string().min(1),
  type: userTypeSchema,
  meta: userMetaSchema,
  groups: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) })),
})

export type DesignerIdentity = z.infer<typeof designerIdentitySchema>

export function resolveHumanPermissions<P extends string, R>(
  rules: readonly { permissions: readonly P[]; restrictions?: readonly R[] }[],
): ResolvedPermissions<P, R> {
  const result = new Map<P, ResolvedPermissionGrant<R>[]>()

  for (const rule of rules) {
    for (const permission of rule.permissions) {
      const grants = result.get(permission) ?? []

      grants.push({
        restrictions: (rule.restrictions ?? []) as ResolvedPermissionGrant<R>["restrictions"],
      })

      result.set(permission, grants)
    }
  }

  return result
}

/**
 * Resolves human role grants in the backend realm; local trust is explicit.
 */
export async function resolveHumanBackendContext(
  database: DatabaseManager,
  identity: DesignerIdentity,
  trustedLocal = false,
): Promise<UserBackendRequestContext> {
  if (trustedLocal && identity.type !== "local") {
    throw new Error("Local identity required")
  }

  const subject = {
    type: "user" as const,
    userId: identity.id,
    groupIds: identity.groups.map(group => group.id),
  }

  const roles = trustedLocal
    ? []
    : await database.backend.backendRole.findMany({
        where: {
          OR: [
            { userBindings: { some: { userId: identity.id } } },
            { groupBindings: { some: { groupId: { in: subject.groupIds } } } },
          ],
        },
        select: { rules: true },
      })

  const rules = trustedLocal
    ? [
        {
          permissions: backendPermissionGroups.flatMap(group =>
            group.permissions.map(permission => permission.name),
          ),
        },
      ]
    : roles.flatMap(role => backendRoleRulesSchema.parse(role.rules))

  return { realm: "backend", subject, permissions: resolveHumanPermissions(rules) }
}

/**
 * Project grants are independent of backend administration grants.
 */
export async function resolveHumanProjectContext(
  database: DatabaseManager,
  identity: DesignerIdentity,
  projectId: string,
  trustedLocal = false,
): Promise<UserProjectRequestContext> {
  if (trustedLocal && identity.type !== "local") {
    throw new Error("Local identity required")
  }

  const project = await database.forProject(projectId)

  await project.user.upsert({
    where: { id: identity.id },
    create: { id: identity.id, type: identity.type, meta: identity.meta },
    update: { type: identity.type, meta: identity.meta },
  })

  const subject = {
    type: "user" as const,
    userId: identity.id,
    groupIds: identity.groups.map(group => group.id),
  }

  const roles = trustedLocal
    ? []
    : await project.role.findMany({
        where: {
          OR: [
            { userBindings: { some: { userId: identity.id } } },
            { groupBindings: { some: { groupId: { in: subject.groupIds } } } },
          ],
        },
        select: { rules: true },
      })

  const rules = trustedLocal
    ? [
        {
          permissions: projectPermissionGroups.flatMap(group =>
            group.permissions.map(permission => permission.name),
          ),
        },
      ]
    : roles.flatMap(role => projectRoleRulesSchema.parse(role.rules))

  return { realm: "project", projectId, subject, permissions: resolveHumanPermissions(rules) }
}

export const humanRoleBindingSchema = z.object({
  roleId: z.cuid2(),
  subject: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user"), id: z.cuid2() }),
    z.object({ type: z.literal("group"), id: z.cuid2() }),
  ]),
  granted: z.boolean(),
})
export type HumanRoleBinding = z.infer<typeof humanRoleBindingSchema>

/**
 * Changes a human grant with the same subset/escalation boundary as role editing.
 */
export async function setHumanBackendRoleBinding(
  database: DatabaseManager,
  context: BackendRequestContext,
  input: HumanRoleBinding,
): Promise<void> {
  const { roleId, subject, granted } = humanRoleBindingSchema.parse(input)
  requireBackendPermission(context, "role.update", { resourceId: roleId })
  const role = await database.backend.backendRole.findUniqueOrThrow({ where: { id: roleId } })
  if (!hasBackendPermissionRulesSubset(context, backendRoleRulesSchema.parse(role.rules))) {
    requireBackendPermission(context, "role.escalate", { resourceId: roleId })
  }

  if (subject.type === "user") {
    if (granted) {
      await database.backend.userBackendRoleBinding.upsert({
        where: { roleId_userId: { roleId, userId: subject.id } },
        create: { roleId, userId: subject.id },
        update: {},
      })
    } else {
      await database.backend.userBackendRoleBinding.deleteMany({
        where: { roleId, userId: subject.id },
      })
    }
  } else {
    if (granted) {
      await database.backend.userGroupBackendRoleBinding.upsert({
        where: { roleId_groupId: { roleId, groupId: subject.id } },
        create: { roleId, groupId: subject.id },
        update: {},
      })
    } else {
      await database.backend.userGroupBackendRoleBinding.deleteMany({
        where: { roleId, groupId: subject.id },
      })
    }
  }
}

/**
 * Binds a known global human or group to a project role without merging realms.
 */
export async function setHumanProjectRoleBinding(
  database: DatabaseManager,
  context: ProjectRequestContext,
  input: HumanRoleBinding,
): Promise<void> {
  const { roleId, subject, granted } = humanRoleBindingSchema.parse(input)
  requireProjectPermission(context, "role.update", { resourceId: roleId })
  const project = await database.forProject(context.projectId)
  const role = await project.role.findUniqueOrThrow({ where: { id: roleId } })
  if (!hasProjectPermissionRulesSubset(context, projectRoleRulesSchema.parse(role.rules))) {
    requireProjectPermission(context, "role.escalate", { resourceId: roleId })
  }

  if (subject.type === "user") {
    const user = await database.backend.user.findUniqueOrThrow({ where: { id: subject.id } })

    await project.user.upsert({
      where: { id: user.id },
      create: { id: user.id, type: user.type, meta: user.meta },
      update: {},
    })

    if (granted) {
      await project.userRoleBinding.upsert({
        where: { roleId_userId: { roleId, userId: subject.id } },
        create: { roleId, userId: subject.id },
        update: {},
      })
    } else {
      await project.userRoleBinding.deleteMany({ where: { roleId, userId: subject.id } })
    }
  } else {
    const group = await database.backend.userGroup.findUniqueOrThrow({ where: { id: subject.id } })

    await project.userGroup.upsert({
      where: { id: group.id },
      create: { id: group.id, meta: group.meta },
      update: {},
    })

    if (granted) {
      await project.userGroupRoleBinding.upsert({
        where: { roleId_groupId: { roleId, groupId: subject.id } },
        create: { roleId, groupId: subject.id },
        update: {},
      })
    } else {
      await project.userGroupRoleBinding.deleteMany({ where: { roleId, groupId: subject.id } })
    }
  }
}
