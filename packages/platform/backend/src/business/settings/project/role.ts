import type { ProjectAuthorizationTarget, ProjectRequestContext } from "../../../common"
import type {
  ArtifactWhereInput,
  DatabaseManager,
  InstanceStateWhereInput,
  OperationWhereInput,
  PageWhereInput,
  PanelWhereInput,
  SecretWhereInput,
  ServiceAccountWhereInput,
  TerminalWhereInput,
  WorkerVersionWhereInput,
  WorkerWhereInput,
} from "../../../database"
import type {
  PageResult,
  ProjectPermission,
  ProjectRoleInput,
  ProjectRoleOutput,
  ProjectRoleQuery,
  ProjectRoleRestrictionOptions,
} from "../../../shared"
import {
  buildProjectAuthorizationWhere,
  hasProjectPermissionRulesSubset,
  requireProjectPermission,
} from "../../../common"
import {
  AuthorizationResourceNotFoundError,
  getProjectPermissionGroup,
  ProjectRoleNotFoundError,
  projectRoleInputSchema,
  SystemProjectRoleReadOnlyError,
} from "../../../shared"
import { querySettingsPage } from "../shared"

export class ProjectRoleSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  /**
   * Queries project roles visible to the request context.
   *
   * @param context The project authorization context.
   * @param query The role collection query.
   * @returns The visible project roles and continuation token.
   */
  async query(
    context: ProjectRequestContext,
    query: ProjectRoleQuery,
  ): Promise<PageResult<ProjectRoleOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = query.search
      ? {
          OR: [
            { id: { contains: query.search } },
            { meta: { path: "title", string_contains: query.search } },
          ],
        }
      : undefined

    const authorization = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "role.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "project-roles",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.role.findMany({
          where: { AND: [where ?? {}, authorization] },
          orderBy: [ProjectRoleSettingsService.buildOrderBy(query), { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
        }),
    })
  }

  /**
   * Gets a project role when the request context can access it.
   *
   * @param context The project authorization context.
   * @param roleId The role ID.
   * @returns The role, or `null` when it does not exist.
   */
  async get(context: ProjectRequestContext, roleId: string): Promise<ProjectRoleOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const role = await database.role.findUnique({ where: { id: roleId } })
    if (!role) {
      return null
    }

    requireProjectPermission(context, "role.get", { resourceId: role.id })

    return role
  }

  /**
   * Creates a project role after validating its permissions and references.
   *
   * @param context The project authorization context.
   * @param input The role definition.
   * @returns The created role.
   */
  async create(
    context: ProjectRequestContext,
    input: ProjectRoleInput,
  ): Promise<ProjectRoleOutput> {
    requireProjectPermission(context, "role.create")

    const database = await this.database.forProject(context.projectId)
    const data = projectRoleInputSchema.parse(input)
    if (!hasProjectPermissionRulesSubset(context, data.rules)) {
      requireProjectPermission(context, "role.escalate")
    }
    await this.validateReferences(context.projectId, data)

    return await database.role.create({ data })
  }

  /**
   * Updates a mutable project role after validating its permissions and references.
   *
   * @param context The project authorization context.
   * @param roleId The role ID.
   * @param input The replacement role definition.
   * @returns The updated role.
   */
  async update(
    context: ProjectRequestContext,
    roleId: string,
    input: ProjectRoleInput,
  ): Promise<ProjectRoleOutput> {
    requireProjectPermission(context, "role.update", { resourceId: roleId })

    await this.assertMutable(context.projectId, roleId)
    const database = await this.database.forProject(context.projectId)
    const data = projectRoleInputSchema.parse(input)
    if (!hasProjectPermissionRulesSubset(context, data.rules)) {
      requireProjectPermission(context, "role.escalate", { resourceId: roleId })
    }
    await this.validateReferences(context.projectId, data)

    return await database.role.update({ where: { id: roleId }, data })
  }

  /**
   * Deletes a mutable project role.
   *
   * @param context The project authorization context.
   * @param roleId The role ID.
   */
  async delete(context: ProjectRequestContext, roleId: string): Promise<void> {
    requireProjectPermission(context, "role.delete", { resourceId: roleId })

    await this.assertMutable(context.projectId, roleId)
    const database = await this.database.forProject(context.projectId)
    await database.role.delete({ where: { id: roleId } })
  }

  /**
   * Gets the project resources available for restriction selection.
   *
   * @param context The project authorization context.
   * @returns The available restriction options.
   */
  async getRestrictionOptions(
    context: ProjectRequestContext,
  ): Promise<ProjectRoleRestrictionOptions> {
    requireProjectPermission(context, "role.get")

    const database = await this.database.forProject(context.projectId)
    const authorization = async <TWhere>(
      permission: ProjectPermission,
      target: ProjectAuthorizationTarget<TWhere>,
    ): Promise<TWhere> =>
      context.permissions.has(permission)
        ? await buildProjectAuthorizationWhere({
            database: this.database,
            context,
            permission,
            target,
          })
        : ({ OR: [] } as TWhere)
    const [
      operations,
      secrets,
      artifacts,
      terminals,
      pages,
      panels,
      workers,
      versions,
      accounts,
      keys,
      roles,
      instances,
    ] = await Promise.all([
      database.operation.findMany({
        where: await authorization<OperationWhereInput>("operation.list", {
          resources: ids => ({ id: { in: [...ids] } }),
        }),
        select: { id: true, meta: true },
      }),
      database.secret.findMany({
        where: await authorization<SecretWhereInput>("secret.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
          owners: ids => ({ serviceAccountId: { in: [...ids] } }),
          self: id => ({ serviceAccountId: id }),
        }),
        select: { id: true, meta: true },
      }),
      database.artifact.findMany({
        where: await authorization<ArtifactWhereInput>("artifact.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          instances: scope => ({ instances: { some: { id: { in: [...scope.stateIds] } } } }),
          owners: ids => ({ serviceAccounts: { some: { id: { in: [...ids] } } } }),
          self: id => ({ serviceAccounts: { some: { id } } }),
        }),
        select: { id: true, meta: true },
      }),
      database.terminal.findMany({
        where: await authorization<TerminalWhereInput>("terminal.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
          owners: ids => ({ serviceAccountId: { in: [...ids] } }),
          self: id => ({ serviceAccountId: id }),
        }),
        select: { id: true, meta: true },
      }),
      database.page.findMany({
        where: await authorization<PageWhereInput>("page.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
          owners: ids => ({ serviceAccountId: { in: [...ids] } }),
          self: id => ({ serviceAccountId: id }),
        }),
        select: { id: true, meta: true },
      }),
      database.panel.findMany({
        where: await authorization<PanelWhereInput>("panel.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
          owners: ids => ({ serviceAccountId: { in: [...ids] } }),
          self: id => ({ serviceAccountId: id }),
          workers: ids => ({ workerVersion: { workerId: { in: [...ids] } } }),
        }),
        select: { id: true, meta: true },
      }),
      database.worker.findMany({
        where: await authorization<WorkerWhereInput>("worker.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          owners: ids => ({ serviceAccountId: { in: [...ids] } }),
          self: id => ({ serviceAccountId: id }),
          workers: ids => ({ id: { in: [...ids] } }),
        }),
        select: { id: true, identity: true },
      }),
      database.workerVersion.findMany({
        where: await authorization<WorkerVersionWhereInput>("worker-version.list", {
          resources: ids => ({ id: { in: [...ids] } }),
          workers: ids => ({ workerId: { in: [...ids] } }),
        }),
        select: { id: true, meta: true },
      }),
      database.serviceAccount.findMany({
        where: await authorization<ServiceAccountWhereInput>("service-account.list", {
          resources: ids => ({ id: { in: [...ids] } }),
        }),
        select: { id: true, meta: true },
      }),
      database.apiKey.findMany({
        where: await authorization("api-key.list", {
          resources: ids => ({ id: { in: [...ids] } }),
        }),
        select: { id: true, meta: true },
      }),
      database.role.findMany({
        where: await authorization("role.list", {
          resources: ids => ({ id: { in: [...ids] } }),
        }),
        select: { id: true, meta: true },
      }),
      database.instanceState.findMany({
        where: await authorization<InstanceStateWhereInput>("instance-state.list", {
          instances: scope => ({ id: { in: [...scope.stateIds] } }),
        }),
        select: { instanceId: true },
      }),
    ])

    const options = <T extends { id: string; meta: unknown }>(items: T[]) =>
      items.map(item => ({
        id: item.id,
        title: (item.meta as { title?: string }).title ?? item.id,
      }))

    return {
      resources: {
        operation: options(operations),
        secret: options(secrets),
        artifact: options(artifacts),
        terminal: options(terminals),
        page: options(pages),
        panel: options(panels),
        worker: workers.map(item => ({ id: item.id, title: item.identity })),
        "worker-version": options(versions),
        "service-account": options(accounts),
        "api-key": options(keys),
        role: options(roles),
      },
      instances: instances.map(item => ({ id: item.instanceId, title: item.instanceId })),
      serviceAccounts: options(accounts),
      workers: workers.map(item => ({ id: item.id, title: item.identity })),
    }
  }

  /**
   * Resolves project restriction options without checking request permissions.
   *
   * @param projectId The project ID.
   * @returns The available restriction options.
   */
  async getRestrictionOptionsCore(projectId: string): Promise<ProjectRoleRestrictionOptions> {
    const database = await this.database.forProject(projectId)
    const [
      operations,
      secrets,
      artifacts,
      terminals,
      pages,
      panels,
      workers,
      versions,
      accounts,
      keys,
      roles,
      instances,
    ] = await Promise.all([
      database.operation.findMany({ select: { id: true, meta: true } }),
      database.secret.findMany({ select: { id: true, meta: true } }),
      database.artifact.findMany({ select: { id: true, meta: true } }),
      database.terminal.findMany({ select: { id: true, meta: true } }),
      database.page.findMany({ select: { id: true, meta: true } }),
      database.panel.findMany({ select: { id: true, meta: true } }),
      database.worker.findMany({ select: { id: true, identity: true } }),
      database.workerVersion.findMany({ select: { id: true, meta: true } }),
      database.serviceAccount.findMany({ select: { id: true, meta: true } }),
      database.apiKey.findMany({ select: { id: true, meta: true } }),
      database.role.findMany({ select: { id: true, meta: true } }),
      database.instanceState.findMany({ select: { instanceId: true } }),
    ])

    const options = <T extends { id: string; meta: unknown }>(items: T[]) =>
      items.map(item => ({
        id: item.id,
        title: (item.meta as { title?: string }).title ?? item.id,
      }))

    return {
      resources: {
        operation: options(operations),
        secret: options(secrets),
        artifact: options(artifacts),
        terminal: options(terminals),
        page: options(pages),
        panel: options(panels),
        worker: workers.map(item => ({ id: item.id, title: item.identity })),
        "worker-version": options(versions),
        "service-account": options(accounts),
        "api-key": options(keys),
        role: options(roles),
      },
      instances: instances.map(item => ({ id: item.instanceId, title: item.instanceId })),
      serviceAccounts: options(accounts),
      workers: workers.map(item => ({ id: item.id, title: item.identity })),
    }
  }

  /**
   * Validates that all project role restriction references exist.
   *
   * @param projectId The project ID.
   * @param input The role rules to validate.
   */
  async validateReferences(
    projectId: string,
    input: Pick<ProjectRoleInput, "rules">,
  ): Promise<void> {
    const options = await this.getRestrictionOptionsCore(projectId)
    for (const rule of input.rules) {
      const group = getProjectPermissionGroup(rule.permissions[0] ?? "")

      for (const restriction of rule.restrictions ?? []) {
        let existingIds: string[]
        switch (restriction.type) {
          case "resources":
            existingIds = options.resources[group?.resourceType ?? ""]?.map(item => item.id) ?? []
            ProjectRoleSettingsService.assertIdsExist(restriction.resourceIds, existingIds)
            break
          case "instances":
            ProjectRoleSettingsService.assertIdsExist(
              restriction.instanceIds,
              options.instances.map(item => item.id),
            )
            break
          case "owners":
            ProjectRoleSettingsService.assertIdsExist(
              restriction.serviceAccountIds,
              options.serviceAccounts.map(item => item.id),
            )
            break
          case "workers":
            ProjectRoleSettingsService.assertIdsExist(
              restriction.workerIds,
              options.workers.map(item => item.id),
            )
            break
        }
      }
    }
  }

  /**
   * Asserts that a project role exists.
   *
   * @param projectId The project ID.
   * @param roleId The role ID.
   */
  async assertExists(projectId: string, roleId: string): Promise<void> {
    const database = await this.database.forProject(projectId)
    const role = await database.role.findUnique({ where: { id: roleId }, select: { id: true } })
    if (!role) {
      throw new ProjectRoleNotFoundError(projectId, roleId)
    }
  }

  private static buildOrderBy(query: ProjectRoleQuery): Record<string, "asc" | "desc"> {
    const sort = query.sortBy?.[0]
    return sort && ["createdAt", "updatedAt"].includes(sort.key)
      ? { [sort.key]: sort.order }
      : { createdAt: "desc" }
  }

  private static assertIdsExist(requested: string[], existing: string[]): void {
    const missing = requested.find(id => !existing.includes(id))

    if (missing) {
      throw new AuthorizationResourceNotFoundError("project", "restriction", missing)
    }
  }

  private async assertMutable(projectId: string, roleId: string): Promise<void> {
    const database = await this.database.forProject(projectId)
    const role = await database.role.findUnique({
      where: { id: roleId },
      select: { systemName: true },
    })

    if (!role) {
      throw new ProjectRoleNotFoundError(projectId, roleId)
    }

    if (role.systemName) {
      throw new SystemProjectRoleReadOnlyError(projectId, roleId)
    }
  }
}
