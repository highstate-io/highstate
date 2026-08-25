import type { ProjectRequestContext } from "../../../common"
import type { ApiKeyWhereInput, DatabaseManager } from "../../../database"
import type {
  ApiKeyInput,
  ApiKeyOutput,
  ApiKeyQuery,
  ApiKeyServiceAccountOption,
  ApiKeyTokenOutput,
  PageResult,
  ProjectRoleRules,
} from "../../../shared"
import type { ProjectRoleSettingsService } from "./role"
import type { ProjectServiceAccountSettingsService } from "./service-account"
import {
  buildProjectAuthorizationWhere,
  hasProjectPermissionRulesSubset,
  permissionRestrictionsCover,
  requireProjectPermission,
} from "../../../common"
import {
  adminProjectServiceAccount,
  apiKeyInputSchema,
  PermissionEscalationError,
  ProjectApiKeyNotFoundError,
  RequiredSystemResourceNotFoundError,
  WorkerManagedApiKeyReadOnlyError,
} from "../../../shared"
import { rotateProjectApiKeyToken } from "../../api-key"
import { querySettingsPage } from "../shared"

export class ProjectApiKeySettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly roles: ProjectRoleSettingsService,
    private readonly serviceAccounts: ProjectServiceAccountSettingsService,
  ) {}

  /**
   * Queries project API keys visible to the request context.
   *
   * @param context The project authorization context.
   * @param query The API key collection query.
   * @returns The visible API keys and continuation token.
   */
  async query(
    context: ProjectRequestContext,
    query: ApiKeyQuery,
  ): Promise<PageResult<ApiKeyOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = {
      ...(query.serviceAccountId ? { serviceAccountId: query.serviceAccountId } : {}),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search } },
              { meta: { path: "title", string_contains: query.search } },
              { serviceAccountId: { contains: query.search } },
            ],
          }
        : {}),
    }
    const sort = query.sortBy?.[0]
    const orderBy =
      sort && ["createdAt", "updatedAt"].includes(sort.key)
        ? { [sort.key]: sort.order }
        : { createdAt: "desc" as const }

    const authorization = await buildProjectAuthorizationWhere<ApiKeyWhereInput>({
      database: this.database,
      context,
      permission: "api-key.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
        owners: serviceAccountIds => ({ serviceAccountId: { in: [...serviceAccountIds] } }),
        self: serviceAccountId => ({ serviceAccountId }),
      },
    })

    return await querySettingsPage({
      collection: "project-api-keys",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) => {
        const items = await database.apiKey.findMany({
          where: { AND: [where, authorization] },
          orderBy: [orderBy, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          include: ProjectApiKeySettingsService.include(),
        })

        return items.map(item => ProjectApiKeySettingsService.toOutput(item))
      },
    })
  }

  /**
   * Gets a project API key when the request context can access it.
   *
   * @param context The project authorization context.
   * @param apiKeyId The API key ID.
   * @returns The API key, or `null` when it does not exist.
   */
  async get(context: ProjectRequestContext, apiKeyId: string): Promise<ApiKeyOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const apiKey = await database.apiKey.findUnique({
      where: { id: apiKeyId },
      include: ProjectApiKeySettingsService.include(),
    })

    if (!apiKey) {
      return null
    }

    requireProjectPermission(context, "api-key.get", {
      resourceId: apiKey.id,
      ownerServiceAccountId: apiKey.serviceAccountId,
    })

    return ProjectApiKeySettingsService.toOutput(apiKey)
  }

  /**
   * Creates a project API key and returns its one-time token.
   *
   * @param context The project authorization context.
   * @param input The API key definition.
   * @returns The created API key and token.
   */
  async create(context: ProjectRequestContext, input: ApiKeyInput): Promise<ApiKeyTokenOutput> {
    requireProjectPermission(context, "api-key.create")

    const database = await this.database.forProject(context.projectId)
    const data = apiKeyInputSchema.parse(input)
    if (!hasProjectPermissionRulesSubset(context, data.restrictionRules)) {
      requireProjectPermission(context, "api-key.escalate")
    }
    const serviceAccountId =
      data.serviceAccountId ?? (await this.getAdminServiceAccountId(context.projectId))
    await this.serviceAccounts.assertExists(context.projectId, serviceAccountId)
    await this.roles.validateReferences(context.projectId, { rules: data.restrictionRules })
    const effectiveRules = await this.validateRestrictions(
      context.projectId,
      serviceAccountId,
      data.restrictionRules,
    )
    if (!hasProjectPermissionRulesSubset(context, effectiveRules)) {
      requireProjectPermission(context, "api-key.escalate")
    }

    return await database.$transaction(async transaction => {
      const created = await transaction.apiKey.create({ data: { ...data, serviceAccountId } })
      const { token } = await rotateProjectApiKeyToken(transaction, created.id)
      const apiKey = await transaction.apiKey.findUniqueOrThrow({
        where: { id: created.id },
        include: ProjectApiKeySettingsService.include(),
      })

      return { apiKey: ProjectApiKeySettingsService.toOutput(apiKey), token }
    })
  }

  /**
   * Updates a mutable project API key.
   *
   * @param context The project authorization context.
   * @param apiKeyId The API key ID.
   * @param input The replacement API key definition.
   * @returns The updated API key.
   */
  async update(
    context: ProjectRequestContext,
    apiKeyId: string,
    input: ApiKeyInput,
  ): Promise<ApiKeyOutput> {
    requireProjectPermission(context, "api-key.update", { resourceId: apiKeyId })

    await this.assertMutable(context.projectId, apiKeyId)
    const database = await this.database.forProject(context.projectId)
    const data = apiKeyInputSchema.parse(input)
    if (!hasProjectPermissionRulesSubset(context, data.restrictionRules)) {
      requireProjectPermission(context, "api-key.escalate", { resourceId: apiKeyId })
    }
    const serviceAccountId =
      data.serviceAccountId ?? (await this.getAdminServiceAccountId(context.projectId))
    await this.serviceAccounts.assertExists(context.projectId, serviceAccountId)
    await this.roles.validateReferences(context.projectId, { rules: data.restrictionRules })
    const effectiveRules = await this.validateRestrictions(
      context.projectId,
      serviceAccountId,
      data.restrictionRules,
    )
    if (!hasProjectPermissionRulesSubset(context, effectiveRules)) {
      requireProjectPermission(context, "api-key.escalate", { resourceId: apiKeyId })
    }

    const apiKey = await database.apiKey.update({
      where: { id: apiKeyId },
      data: { ...data, serviceAccountId },
      include: ProjectApiKeySettingsService.include(),
    })

    return ProjectApiKeySettingsService.toOutput(apiKey)
  }

  /**
   * Deletes a mutable project API key.
   *
   * @param context The project authorization context.
   * @param apiKeyId The API key ID.
   */
  async delete(context: ProjectRequestContext, apiKeyId: string): Promise<void> {
    requireProjectPermission(context, "api-key.delete", { resourceId: apiKeyId })

    await this.assertMutable(context.projectId, apiKeyId)
    const database = await this.database.forProject(context.projectId)
    await database.apiKey.delete({ where: { id: apiKeyId } })
  }

  /**
   * Gets service accounts available for project API key ownership.
   *
   * @param context The project authorization context.
   * @returns The service account options and effective rules.
   */
  async getServiceAccountOptions(
    context: ProjectRequestContext,
  ): Promise<ApiKeyServiceAccountOption[]> {
    const database = await this.database.forProject(context.projectId)
    const authorization = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "service-account.list",
      target: {
        resources: serviceAccountIds => ({ id: { in: [...serviceAccountIds] } }),
      },
    })

    const roleAuthorization = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "role.list",
      target: {
        resources: roleIds => ({ id: { in: [...roleIds] } }),
      },
    })
    const accounts = await database.serviceAccount.findMany({
      where: authorization,
      orderBy: { createdAt: "asc" },
      include: {
        roleBindings: {
          where: { role: roleAuthorization },
          include: { role: { select: { rules: true } } },
        },
      },
    })
    return accounts.map(({ roleBindings, ...account }) => ({
      ...account,
      rules: roleBindings.flatMap(binding => binding.role.rules),
    }))
  }

  /**
   * Asserts that a project API key is mutable.
   *
   * @param projectId The project ID.
   * @param apiKeyId The API key ID.
   */
  async assertMutable(projectId: string, apiKeyId: string): Promise<void> {
    const database = await this.database.forProject(projectId)
    const apiKey = await database.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { worker: { select: { id: true } } },
    })

    if (!apiKey) {
      throw new ProjectApiKeyNotFoundError(projectId, apiKeyId)
    }

    if (apiKey.worker) {
      throw new WorkerManagedApiKeyReadOnlyError(projectId, apiKeyId)
    }
  }

  private async validateRestrictions(
    projectId: string,
    serviceAccountId: string,
    rules: ApiKeyOutput["restrictionRules"],
  ): Promise<ProjectRoleRules> {
    const database = await this.database.forProject(projectId)
    const bindings = await database.serviceAccountRoleBinding.findMany({
      where: { serviceAccountId },
      include: { role: { select: { rules: true } } },
    })
    const grants = bindings.flatMap(binding => binding.role.rules)

    if (rules.length === 0) {
      return grants
    }

    for (const rule of rules) {
      for (const permission of rule.permissions) {
        const covered = grants.some(
          grant =>
            grant.permissions.includes(permission) &&
            permissionRestrictionsCover(grant.restrictions, rule.restrictions),
        )
        if (!covered) {
          throw new PermissionEscalationError(permission)
        }
      }
    }

    return rules
  }

  private async getAdminServiceAccountId(projectId: string): Promise<string> {
    const database = await this.database.forProject(projectId)
    const account = await database.serviceAccount.findUnique({
      where: { systemName: adminProjectServiceAccount.systemName },
      select: { id: true },
    })

    if (!account) {
      throw new RequiredSystemResourceNotFoundError("admin-project-service-account")
    }

    return account.id
  }

  private static include() {
    return { serviceAccount: { select: { meta: true } }, worker: { select: { id: true } } } as const
  }

  private static toOutput(apiKey: {
    id: string
    meta: ApiKeyOutput["meta"]
    serviceAccountId: string
    restrictionRules: ApiKeyOutput["restrictionRules"]
    expiresAt: Date | null
    lastUsedAt: Date | null
    createdAt: Date
    updatedAt: Date
    serviceAccount: { meta: NonNullable<ApiKeyOutput["serviceAccountMeta"]> }
    worker: { id: string } | null
  }): ApiKeyOutput {
    return {
      id: apiKey.id,
      meta: apiKey.meta,
      serviceAccountId: apiKey.serviceAccountId,
      serviceAccountMeta: apiKey.serviceAccount.meta,
      restrictionRules: apiKey.restrictionRules,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
      managed: !!apiKey.worker,
    }
  }
}
