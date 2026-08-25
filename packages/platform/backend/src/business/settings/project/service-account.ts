import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager } from "../../../database"
import type {
  PageResult,
  ProjectRoleBindingOutput,
  ServiceAccountInput,
  ServiceAccountOutput,
  ServiceAccountQuery,
} from "../../../shared"
import type { ProjectRoleSettingsService } from "./role"
import {
  buildProjectAuthorizationWhere,
  hasProjectPermissionRulesSubset,
  requireProjectPermission,
} from "../../../common"
import {
  forSchema,
  ProjectServiceAccountNotFoundError,
  SystemProjectServiceAccountReadOnlyError,
  serviceAccountInputSchema,
  serviceAccountOutputSchema,
} from "../../../shared"
import { querySettingsPage } from "../shared"

export class ProjectServiceAccountSettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly roles: ProjectRoleSettingsService,
  ) {}

  async query(
    context: ProjectRequestContext,
    query: ServiceAccountQuery,
  ): Promise<PageResult<ServiceAccountOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = {
      ...(query.artifactId ? { artifacts: { some: { id: query.artifactId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search } },
              { meta: { path: "title", string_contains: query.search } },
            ],
          }
        : {}),
    }
    const sort = query.sortBy?.[0]
    const orderBy =
      sort && ["createdAt", "updatedAt"].includes(sort.key)
        ? { [sort.key]: sort.order }
        : { createdAt: "desc" as const }

    const authorization = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "service-account.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "project-service-accounts",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.serviceAccount.findMany({
          where: { AND: [where, authorization] },
          orderBy: [orderBy, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: forSchema(serviceAccountOutputSchema),
        }),
    })
  }

  async get(
    context: ProjectRequestContext,
    serviceAccountId: string,
  ): Promise<ServiceAccountOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const account = await database.serviceAccount.findUnique({
      where: { id: serviceAccountId },
      select: forSchema(serviceAccountOutputSchema),
    })
    if (!account) {
      return null
    }

    requireProjectPermission(context, "service-account.get", { resourceId: account.id })

    return account
  }

  async create(
    context: ProjectRequestContext,
    input: ServiceAccountInput,
  ): Promise<ServiceAccountOutput> {
    requireProjectPermission(context, "service-account.manage")

    const database = await this.database.forProject(context.projectId)
    return await database.serviceAccount.create({ data: serviceAccountInputSchema.parse(input) })
  }

  async update(
    context: ProjectRequestContext,
    serviceAccountId: string,
    input: ServiceAccountInput,
  ): Promise<ServiceAccountOutput> {
    requireProjectPermission(context, "service-account.manage", { resourceId: serviceAccountId })

    await this.assertMutable(context.projectId, serviceAccountId)
    const database = await this.database.forProject(context.projectId)

    return await database.serviceAccount.update({
      where: { id: serviceAccountId },
      data: serviceAccountInputSchema.parse(input),
    })
  }

  async delete(context: ProjectRequestContext, serviceAccountId: string): Promise<void> {
    requireProjectPermission(context, "service-account.manage", { resourceId: serviceAccountId })

    await this.assertMutable(context.projectId, serviceAccountId)
    const database = await this.database.forProject(context.projectId)
    await database.serviceAccount.delete({ where: { id: serviceAccountId } })
  }

  async getRoleBindings(
    context: ProjectRequestContext,
    serviceAccountId: string,
  ): Promise<ProjectRoleBindingOutput[]> {
    requireProjectPermission(context, "role-binding.list")
    requireProjectPermission(context, "service-account.get", { resourceId: serviceAccountId })

    const database = await this.database.forProject(context.projectId)
    return await database.serviceAccountRoleBinding.findMany({
      where: { serviceAccountId },
      orderBy: { createdAt: "asc" },
    })
  }

  async getRoleBindingsByRole(
    context: ProjectRequestContext,
    roleId: string,
  ): Promise<ProjectRoleBindingOutput[]> {
    requireProjectPermission(context, "role-binding.list")
    requireProjectPermission(context, "role.get", { resourceId: roleId })

    const database = await this.database.forProject(context.projectId)
    return await database.serviceAccountRoleBinding.findMany({
      where: { roleId },
      orderBy: { createdAt: "asc" },
    })
  }

  async addRoleBinding(
    context: ProjectRequestContext,
    roleId: string,
    serviceAccountId: string,
  ): Promise<void> {
    requireProjectPermission(context, "role-binding.create")

    await Promise.all([
      this.roles.assertExists(context.projectId, roleId),
      this.assertMutable(context.projectId, serviceAccountId),
    ])

    const database = await this.database.forProject(context.projectId)
    const role = await database.role.findUniqueOrThrow({
      where: { id: roleId },
      select: { rules: true },
    })
    if (!hasProjectPermissionRulesSubset(context, role.rules)) {
      requireProjectPermission(context, "role-binding.bind")
    }
    await database.serviceAccountRoleBinding.upsert({
      where: { roleId_serviceAccountId: { roleId, serviceAccountId } },
      create: { roleId, serviceAccountId },
      update: {},
    })
  }

  async removeRoleBinding(
    context: ProjectRequestContext,
    roleId: string,
    serviceAccountId: string,
  ): Promise<void> {
    requireProjectPermission(context, "role-binding.delete")

    await Promise.all([
      this.roles.assertExists(context.projectId, roleId),
      this.assertMutable(context.projectId, serviceAccountId),
    ])

    const database = await this.database.forProject(context.projectId)
    await database.serviceAccountRoleBinding.delete({
      where: { roleId_serviceAccountId: { roleId, serviceAccountId } },
    })
  }

  async assertExists(projectId: string, serviceAccountId: string): Promise<void> {
    const database = await this.database.forProject(projectId)
    const account = await database.serviceAccount.findUnique({
      where: { id: serviceAccountId },
      select: { id: true },
    })
    if (!account) {
      throw new ProjectServiceAccountNotFoundError(projectId, serviceAccountId)
    }
  }

  private async assertMutable(projectId: string, serviceAccountId: string): Promise<void> {
    const database = await this.database.forProject(projectId)
    const account = await database.serviceAccount.findUnique({
      where: { id: serviceAccountId },
      select: { systemName: true },
    })
    if (!account) {
      throw new ProjectServiceAccountNotFoundError(projectId, serviceAccountId)
    }

    if (account.systemName) {
      throw new SystemProjectServiceAccountReadOnlyError(projectId, serviceAccountId)
    }
  }
}
