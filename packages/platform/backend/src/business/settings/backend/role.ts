import type { BackendAuthorizationTarget, BackendRequestContext } from "../../../common"
import type {
  BackendApiKeyWhereInput,
  BackendRoleWhereInput,
  BackendServiceAccountWhereInput,
  DatabaseManager,
  LibraryWhereInput,
  ProjectModelStorageWhereInput,
  ProjectSpaceWhereInput,
  ProjectWhereInput,
  PulumiBackendWhereInput,
} from "../../../database"
import type {
  BackendPermission,
  BackendResourceType,
  BackendRoleInput,
  BackendRoleOutput,
  BackendRoleQuery,
  BackendRoleRestrictionOption,
  BackendRoleRestrictionOptions,
  PageResult,
} from "../../../shared"
import {
  buildBackendAuthorizationWhere,
  hasBackendPermissionRulesSubset,
  requireBackendPermission,
} from "../../../common"
import {
  AuthorizationResourceNotFoundError,
  BackendRoleNotFoundError,
  backendRoleInputSchema,
  getBackendPermissionGroup,
  PermissionGroupNotFoundError,
  PermissionGroupResourceUnsupportedError,
  SystemBackendRoleReadOnlyError,
} from "../../../shared"
import { querySettingsPage } from "../shared"

export class BackendRoleSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  /**
   * Queries backend roles visible to the request context.
   *
   * @param context The backend authorization context.
   * @param query The role collection query.
   * @returns The visible backend roles and continuation token.
   */
  async query(
    context: BackendRequestContext,
    query: BackendRoleQuery,
  ): Promise<PageResult<BackendRoleOutput>> {
    const where = query.search
      ? { OR: [{ id: { contains: query.search } }, { systemName: { contains: query.search } }] }
      : undefined

    const authorization = await buildBackendAuthorizationWhere({
      database: this.database,
      context,
      permission: "role.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "backend-roles",
      request: query,
      query,
      fetch: async ({ cursorId, take }) =>
        await this.database.backend.backendRole.findMany({
          where: { AND: [where ?? {}, authorization] },
          orderBy: [BackendRoleSettingsService.buildOrderBy(query), { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
        }),
    })
  }

  /**
   * Gets a backend role when the request context can access it.
   *
   * @param context The backend authorization context.
   * @param roleId The role ID.
   * @returns The role, or `null` when it does not exist.
   */
  async get(context: BackendRequestContext, roleId: string): Promise<BackendRoleOutput | null> {
    const role = await this.database.backend.backendRole.findUnique({ where: { id: roleId } })
    if (!role) {
      return null
    }

    requireBackendPermission(context, "role.get", { resourceId: role.id })

    return role
  }

  /**
   * Creates a backend role after validating its permissions and references.
   *
   * @param context The backend authorization context.
   * @param input The role definition.
   * @returns The created role.
   */
  async create(
    context: BackendRequestContext,
    input: BackendRoleInput,
  ): Promise<BackendRoleOutput> {
    requireBackendPermission(context, "role.create")

    const data = backendRoleInputSchema.parse(input)
    if (!hasBackendPermissionRulesSubset(context, data.rules)) {
      requireBackendPermission(context, "role.escalate")
    }
    await this.validateReferences(data)

    return await this.database.backend.backendRole.create({ data })
  }

  /**
   * Updates a mutable backend role after validating its permissions and references.
   *
   * @param context The backend authorization context.
   * @param roleId The role ID.
   * @param input The replacement role definition.
   * @returns The updated role.
   */
  async update(
    context: BackendRequestContext,
    roleId: string,
    input: BackendRoleInput,
  ): Promise<BackendRoleOutput> {
    requireBackendPermission(context, "role.update", { resourceId: roleId })
    await this.assertMutable(roleId)
    const data = backendRoleInputSchema.parse(input)
    if (!hasBackendPermissionRulesSubset(context, data.rules)) {
      requireBackendPermission(context, "role.escalate", { resourceId: roleId })
    }
    await this.validateReferences(data)

    return await this.database.backend.backendRole.update({ where: { id: roleId }, data })
  }

  /**
   * Deletes a mutable backend role.
   *
   * @param context The backend authorization context.
   * @param roleId The role ID.
   */
  async delete(context: BackendRequestContext, roleId: string): Promise<void> {
    requireBackendPermission(context, "role.delete", { resourceId: roleId })

    await this.assertMutable(roleId)
    await this.database.backend.backendRole.delete({ where: { id: roleId } })
  }

  /**
   * Gets the backend resources available for restriction selection.
   *
   * @param context The backend authorization context.
   * @returns The available restriction options.
   */
  async getRestrictionOptions(
    context: BackendRequestContext,
  ): Promise<BackendRoleRestrictionOptions> {
    requireBackendPermission(context, "role.get")

    const authorization = async <TWhere>(
      permission: BackendPermission,
      target: BackendAuthorizationTarget<TWhere>,
    ): Promise<TWhere> =>
      context.permissions.has(permission)
        ? await buildBackendAuthorizationWhere({
            database: this.database,
            context,
            permission,
            target,
          })
        : ({ OR: [] } as TWhere)
    const [projects, projectSpaces, libraries, pulumiBackends, storages, accounts, keys, roles] =
      await Promise.all([
        this.database.backend.project.findMany({
          where: await authorization<ProjectWhereInput>("project.list", {
            projects: ids => ({ id: { in: [...ids] } }),
            projectsInSpaces: ids => ({ spaceId: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.projectSpace.findMany({
          where: await authorization<ProjectSpaceWhereInput>("project-space.list", {
            projectSpaces: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.library.findMany({
          where: await authorization<LibraryWhereInput>("library.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.pulumiBackend.findMany({
          where: await authorization<PulumiBackendWhereInput>("pulumi-backend.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.projectModelStorage.findMany({
          where: await authorization<ProjectModelStorageWhereInput>("project-model-storage.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.backendServiceAccount.findMany({
          where: await authorization<BackendServiceAccountWhereInput>("service-account.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.backendApiKey.findMany({
          where: await authorization<BackendApiKeyWhereInput>("api-key.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
        this.database.backend.backendRole.findMany({
          where: await authorization<BackendRoleWhereInput>("role.list", {
            resources: ids => ({ id: { in: [...ids] } }),
          }),
          select: { id: true, meta: true },
        }),
      ])
    return {
      projects,
      projectSpaces,
      resources: {
        library: libraries,
        "pulumi-backend": pulumiBackends,
        "project-model-storage": storages,
        "backend-service-account": accounts,
        "backend-api-key": keys,
        "backend-role": roles,
      },
    }
  }

  /**
   * Validates that all backend role restriction references exist.
   *
   * @param input The role rules to validate.
   */
  async validateReferences(input: Pick<BackendRoleInput, "rules">): Promise<void> {
    for (const rule of input.rules) {
      const group = getBackendPermissionGroup(rule.permissions[0] ?? "")

      if (!group) {
        throw new PermissionGroupNotFoundError("backend", rule.permissions[0] ?? "")
      }

      for (const restriction of rule.restrictions ?? []) {
        if (restriction.type === "resources") {
          if (!("resourceType" in group) || !group.resourceType) {
            throw new PermissionGroupResourceUnsupportedError("backend", group.title)
          }
          await this.assertResourcesExist(group.resourceType, restriction.resourceIds)
        } else if (restriction.type === "projects") {
          BackendRoleSettingsService.assertIdsExist(
            "project",
            restriction.projectIds,
            await this.database.backend.project.findMany({
              where: { id: { in: restriction.projectIds } },
              select: { id: true },
            }),
          )
        } else {
          BackendRoleSettingsService.assertIdsExist(
            "project space",
            restriction.projectSpaceIds,
            await this.database.backend.projectSpace.findMany({
              where: { id: { in: restriction.projectSpaceIds } },
              select: { id: true },
            }),
          )
        }
      }
    }
  }

  /**
   * Asserts that a backend role exists.
   *
   * @param roleId The role ID.
   */
  async assertExists(roleId: string): Promise<void> {
    const role = await this.database.backend.backendRole.findUnique({
      where: { id: roleId },
      select: { id: true },
    })

    if (!role) {
      throw new BackendRoleNotFoundError(roleId)
    }
  }

  private static buildOrderBy(query: BackendRoleQuery): Record<string, "asc" | "desc"> {
    const sort = query.sortBy?.[0]
    return sort && ["createdAt", "updatedAt", "systemName"].includes(sort.key)
      ? { [sort.key]: sort.order }
      : { createdAt: "desc" }
  }

  private async assertResourcesExist(type: BackendResourceType, ids: string[]): Promise<void> {
    let resources: BackendRoleRestrictionOption[]
    switch (type) {
      case "library":
        resources = await this.database.backend.library.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
      case "pulumi-backend":
        resources = await this.database.backend.pulumiBackend.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
      case "project-model-storage":
        resources = await this.database.backend.projectModelStorage.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
      case "backend-service-account":
        resources = await this.database.backend.backendServiceAccount.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
      case "backend-api-key":
        resources = await this.database.backend.backendApiKey.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
      case "backend-role":
        resources = await this.database.backend.backendRole.findMany({
          where: { id: { in: ids } },
          select: { id: true, meta: true },
        })
        break
    }

    BackendRoleSettingsService.assertIdsExist(type, ids, resources)
  }

  private static assertIdsExist(
    type: string,
    requestedIds: string[],
    existing: { id: string }[],
  ): void {
    const ids = new Set(existing.map(item => item.id))
    const missing = requestedIds.find(id => !ids.has(id))

    if (missing) {
      throw new AuthorizationResourceNotFoundError("backend", type, missing)
    }
  }

  private async assertMutable(roleId: string): Promise<void> {
    const role = await this.database.backend.backendRole.findUnique({
      where: { id: roleId },
      select: { systemName: true },
    })

    if (!role) {
      throw new BackendRoleNotFoundError(roleId)
    }

    if (role.systemName) {
      throw new SystemBackendRoleReadOnlyError(roleId)
    }
  }
}
