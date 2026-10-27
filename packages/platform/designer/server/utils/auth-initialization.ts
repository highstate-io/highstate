import type { Services } from "@highstate/backend"
import { getHostedAuthConfig } from "./auth-config"

export async function initializeHostedAuth(services: Services): Promise<void> {
  const config = getHostedAuthConfig()
  if (process.env.HIGHSTATE_BACKEND_DATABASE_TYPE !== "postgresql")
    throw new Error("Hosted authentication requires HIGHSTATE_BACKEND_DATABASE_TYPE=postgresql")
  if (!config.adminUserIds.length && !config.adminGroupIds.length) return
  await services.database.backend.$transaction(async database => {
    const role = await database.backendRole.findUniqueOrThrow({ where: { systemName: "admin" } })
    for (const id of config.adminUserIds) {
      await database.user.upsert({
        where: { id },
        create: { id, type: "oidc", meta: { title: id } },
        update: {},
      })
      await database.userBackendRoleBinding.upsert({
        where: { roleId_userId: { roleId: role.id, userId: id } },
        create: { roleId: role.id, userId: id },
        update: {},
      })
    }
    for (const id of config.adminGroupIds) {
      await database.userGroup.upsert({
        where: { id },
        create: { id, meta: { title: id } },
        update: {},
      })
      await database.userGroupBackendRoleBinding.upsert({
        where: { roleId_groupId: { roleId: role.id, groupId: id } },
        create: { roleId: role.id, groupId: id },
        update: {},
      })
    }
  })
}

export async function initializeHostedProjectAuth(
  services: Services,
  projectId: string,
): Promise<void> {
  const config = getHostedAuthConfig()
  if (!config.adminUserIds.length && !config.adminGroupIds.length) return
  const project = await services.database.forProject(projectId)
  await project.$transaction(async database => {
    const role = await database.role.findUniqueOrThrow({ where: { systemName: "admin" } })
    for (const id of config.adminUserIds) {
      await database.user.upsert({
        where: { id },
        create: { id, type: "oidc", meta: { title: id } },
        update: {},
      })
      await database.userRoleBinding.upsert({
        where: { roleId_userId: { roleId: role.id, userId: id } },
        create: { roleId: role.id, userId: id },
        update: {},
      })
    }
    for (const id of config.adminGroupIds) {
      await database.userGroup.upsert({
        where: { id },
        create: { id, meta: { title: id } },
        update: {},
      })
      await database.userGroupRoleBinding.upsert({
        where: { roleId_groupId: { roleId: role.id, groupId: id } },
        create: { roleId: role.id, groupId: id },
        update: {},
      })
    }
  })
}
