import type { BackendRequestContext } from "../../../common"
import type {
  BackendServiceAccountWhereInput,
  DatabaseManager,
  ProjectWhereInput,
} from "../../../database"
import type {
  BackendProjectServiceAccountOption,
  BackendServiceAccountInput,
  BackendServiceAccountOutput,
  BackendServiceAccountProjectBindingOutput,
  BackendServiceAccountQuery,
  PageResult,
  ServiceAccountBackendRoleBindingOutput,
} from "../../../shared"
import type { ProjectUnlockBackend } from "../../../unlock"
import type { BackendRoleSettingsService } from "./role"
import {
  buildBackendAuthorizationWhere,
  hasBackendPermissionRulesSubset,
  requireBackendPermission,
} from "../../../common"
import {
  BackendServiceAccountNotFoundError,
  backendServiceAccountInputSchema,
  ProjectLockedError,
  ProjectServiceAccountNotFoundError,
  SystemBackendServiceAccountReadOnlyError,
} from "../../../shared"
import { querySettingsPage } from "../shared"

export class BackendServiceAccountSettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly projectUnlockBackend: ProjectUnlockBackend,
    private readonly roles: BackendRoleSettingsService,
  ) {}

  async query(
    context: BackendRequestContext,
    query: BackendServiceAccountQuery,
  ): Promise<PageResult<BackendServiceAccountOutput>> {
    const where = query.search
      ? { OR: [{ id: { contains: query.search } }, { systemName: { contains: query.search } }] }
      : undefined
    const sort = query.sortBy?.[0]
    const orderBy =
      sort && ["createdAt", "updatedAt", "systemName"].includes(sort.key)
        ? { [sort.key]: sort.order }
        : { createdAt: "desc" as const }

    const authorization = await buildBackendAuthorizationWhere<BackendServiceAccountWhereInput>({
      database: this.database,
      context,
      permission: "service-account.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "backend-service-accounts",
      request: query,
      query,
      fetch: async ({ cursorId, take }) =>
        await this.database.backend.backendServiceAccount.findMany({
          where: { AND: [where ?? {}, authorization] },
          orderBy: [orderBy, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
        }),
    })
  }

  async get(
    context: BackendRequestContext,
    serviceAccountId: string,
  ): Promise<BackendServiceAccountOutput | null> {
    const account = await this.database.backend.backendServiceAccount.findUnique({
      where: { id: serviceAccountId },
    })

    if (!account) {
      return null
    }

    requireBackendPermission(context, "service-account.get", { resourceId: account.id })

    return account
  }

  async create(
    context: BackendRequestContext,
    input: BackendServiceAccountInput,
  ): Promise<BackendServiceAccountOutput> {
    requireBackendPermission(context, "service-account.manage")

    return await this.database.backend.backendServiceAccount.create({
      data: backendServiceAccountInputSchema.parse(input),
    })
  }

  async update(
    context: BackendRequestContext,
    serviceAccountId: string,
    input: BackendServiceAccountInput,
  ): Promise<BackendServiceAccountOutput> {
    requireBackendPermission(context, "service-account.manage", { resourceId: serviceAccountId })

    await this.assertMutable(serviceAccountId)

    return await this.database.backend.backendServiceAccount.update({
      where: { id: serviceAccountId },
      data: backendServiceAccountInputSchema.parse(input),
    })
  }

  async delete(context: BackendRequestContext, serviceAccountId: string): Promise<void> {
    requireBackendPermission(context, "service-account.manage", { resourceId: serviceAccountId })

    await this.assertMutable(serviceAccountId)
    await this.database.backend.backendServiceAccount.delete({ where: { id: serviceAccountId } })
  }

  async getRoleBindings(
    context: BackendRequestContext,
    serviceAccountId: string,
  ): Promise<ServiceAccountBackendRoleBindingOutput[]> {
    requireBackendPermission(context, "role-binding.list")
    requireBackendPermission(context, "service-account.get", { resourceId: serviceAccountId })

    return await this.database.backend.serviceAccountBackendRoleBinding.findMany({
      where: { serviceAccountId },
      orderBy: { createdAt: "asc" },
    })
  }

  async getRoleBindingsByRole(
    context: BackendRequestContext,
    roleId: string,
  ): Promise<ServiceAccountBackendRoleBindingOutput[]> {
    requireBackendPermission(context, "role-binding.list")
    requireBackendPermission(context, "role.get", { resourceId: roleId })

    return await this.database.backend.serviceAccountBackendRoleBinding.findMany({
      where: { roleId },
      orderBy: { createdAt: "asc" },
    })
  }

  async addRoleBinding(
    context: BackendRequestContext,
    roleId: string,
    serviceAccountId: string,
  ): Promise<void> {
    requireBackendPermission(context, "role-binding.create")

    await Promise.all([this.roles.assertExists(roleId), this.assertMutable(serviceAccountId)])
    const role = await this.database.backend.backendRole.findUniqueOrThrow({
      where: { id: roleId },
      select: { rules: true },
    })
    if (!hasBackendPermissionRulesSubset(context, role.rules)) {
      requireBackendPermission(context, "role-binding.bind")
    }
    await this.database.backend.serviceAccountBackendRoleBinding.upsert({
      where: { roleId_serviceAccountId: { roleId, serviceAccountId } },
      create: { roleId, serviceAccountId },
      update: {},
    })
  }

  async removeRoleBinding(
    context: BackendRequestContext,
    roleId: string,
    serviceAccountId: string,
  ): Promise<void> {
    requireBackendPermission(context, "role-binding.delete")

    await Promise.all([this.roles.assertExists(roleId), this.assertMutable(serviceAccountId)])
    await this.database.backend.serviceAccountBackendRoleBinding.delete({
      where: { roleId_serviceAccountId: { roleId, serviceAccountId } },
    })
  }

  async getProjectBindingOptions(
    context: BackendRequestContext,
    serviceAccountId: string,
  ): Promise<BackendProjectServiceAccountOption[]> {
    requireBackendPermission(context, "backend-service-account-project-binding.list")

    await this.assertExists(serviceAccountId)
    const authorization = await buildBackendAuthorizationWhere<ProjectWhereInput>({
      database: this.database,
      context,
      permission: "backend-service-account-project-binding.list",
      target: {
        projects: projectIds => ({ id: { in: [...projectIds] } }),
        projectsInSpaces: projectSpaceIds => ({ spaceId: { in: [...projectSpaceIds] } }),
      },
    })
    const projects = await this.database.backend.project.findMany({
      where: authorization,
      orderBy: { createdAt: "asc" },
      select: { id: true, meta: true },
    })
    const bindings = await this.database.backend.backendServiceAccountProjectBinding.findMany({
      where: { backendServiceAccountId: serviceAccountId },
    })
    const byProject = new Map(bindings.map(binding => [binding.projectId, binding]))

    return await Promise.all(
      projects.map(async project => {
        const unlocked = await this.projectUnlockBackend.checkProjectUnlocked(project.id)
        if (!unlocked) {
          return {
            projectId: project.id,
            projectMeta: project.meta,
            unlocked: false,
            serviceAccounts: [],
            binding: byProject.get(project.id) ?? null,
          }
        }

        const database = await this.database.forProject(project.id)
        const serviceAccounts = await database.serviceAccount.findMany({
          orderBy: { createdAt: "asc" },
          select: { id: true, meta: true, systemName: true },
        })

        return {
          projectId: project.id,
          projectMeta: project.meta,
          unlocked: true,
          serviceAccounts,
          binding: byProject.get(project.id) ?? null,
        }
      }),
    )
  }

  async setProjectBinding(
    context: BackendRequestContext,
    serviceAccountId: string,
    projectId: string,
    projectServiceAccountId: string | null,
  ): Promise<BackendServiceAccountProjectBindingOutput | null> {
    requireBackendPermission(context, "backend-service-account-project-binding.bind", { projectId })

    await this.assertMutable(serviceAccountId)

    if (projectServiceAccountId === null) {
      await this.database.backend.backendServiceAccountProjectBinding.deleteMany({
        where: { backendServiceAccountId: serviceAccountId, projectId },
      })

      return null
    }

    if (!(await this.projectUnlockBackend.checkProjectUnlocked(projectId))) {
      throw new ProjectLockedError(projectId)
    }

    const database = await this.database.forProject(projectId)
    const account = await database.serviceAccount.findUnique({
      where: { id: projectServiceAccountId },
      select: { id: true },
    })

    if (!account) {
      throw new ProjectServiceAccountNotFoundError(projectId, projectServiceAccountId)
    }

    return await this.database.backend.backendServiceAccountProjectBinding.upsert({
      where: {
        backendServiceAccountId_projectId: { backendServiceAccountId: serviceAccountId, projectId },
      },
      create: { backendServiceAccountId: serviceAccountId, projectId, projectServiceAccountId },
      update: { projectServiceAccountId },
    })
  }

  async assertExists(serviceAccountId: string): Promise<void> {
    const account = await this.database.backend.backendServiceAccount.findUnique({
      where: { id: serviceAccountId },
      select: { id: true },
    })

    if (!account) {
      throw new BackendServiceAccountNotFoundError(serviceAccountId)
    }
  }

  private async assertMutable(serviceAccountId: string): Promise<void> {
    const account = await this.database.backend.backendServiceAccount.findUnique({
      where: { id: serviceAccountId },
      select: { systemName: true },
    })

    if (!account) {
      throw new BackendServiceAccountNotFoundError(serviceAccountId)
    }

    if (account.systemName) {
      throw new SystemBackendServiceAccountReadOnlyError(serviceAccountId)
    }
  }
}
