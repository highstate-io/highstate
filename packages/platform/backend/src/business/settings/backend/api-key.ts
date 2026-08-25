import type { BackendRequestContext } from "../../../common"
import type { DatabaseManager } from "../../../database"
import type {
  BackendApiKeyInput,
  BackendApiKeyOutput,
  BackendApiKeyQuery,
  BackendApiKeyServiceAccountOption,
  BackendApiKeyTokenOutput,
  BackendRoleRules,
  PageResult,
} from "../../../shared"
import type { BackendRoleSettingsService } from "./role"
import type { BackendServiceAccountSettingsService } from "./service-account"
import {
  buildBackendAuthorizationWhere,
  hasBackendPermissionRulesSubset,
  permissionRestrictionsCover,
  requireBackendPermission,
} from "../../../common"
import {
  adminBackendServiceAccount,
  BackendApiKeyNotFoundError,
  backendApiKeyInputSchema,
  PermissionEscalationError,
  RequiredSystemResourceNotFoundError,
} from "../../../shared"
import { rotateBackendApiKeyToken } from "../../api-key"
import { querySettingsPage } from "../shared"

export class BackendApiKeySettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly roles: BackendRoleSettingsService,
    private readonly serviceAccounts: BackendServiceAccountSettingsService,
  ) {}

  /**
   * Queries backend API keys visible to the request context.
   *
   * @param context The backend authorization context.
   * @param query The API key collection query.
   * @returns The visible API keys and continuation token.
   */
  async query(
    context: BackendRequestContext,
    query: BackendApiKeyQuery,
  ): Promise<PageResult<BackendApiKeyOutput>> {
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
      sort && ["createdAt", "updatedAt", "systemName"].includes(sort.key)
        ? { [sort.key]: sort.order }
        : { createdAt: "desc" as const }

    const authorization = await buildBackendAuthorizationWhere({
      database: this.database,
      context,
      permission: "api-key.list",
      target: {
        resources: resourceIds => ({ id: { in: [...resourceIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "backend-api-keys",
      request: query,
      query,
      fetch: async ({ cursorId, take }) => {
        const items = await this.database.backend.backendApiKey.findMany({
          where: { AND: [where, authorization] },
          orderBy: [orderBy, { id: "asc" }],
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          include: BackendApiKeySettingsService.include(),
        })

        return items.map(item => BackendApiKeySettingsService.toOutput(item))
      },
    })
  }

  /**
   * Gets a backend API key when the request context can access it.
   *
   * @param context The backend authorization context.
   * @param apiKeyId The API key ID.
   * @returns The API key, or `null` when it does not exist.
   */
  async get(context: BackendRequestContext, apiKeyId: string): Promise<BackendApiKeyOutput | null> {
    const apiKey = await this.database.backend.backendApiKey.findUnique({
      where: { id: apiKeyId },
      include: BackendApiKeySettingsService.include(),
    })

    if (!apiKey) {
      return null
    }

    requireBackendPermission(context, "api-key.get", { resourceId: apiKey.id })

    return BackendApiKeySettingsService.toOutput(apiKey)
  }

  /**
   * Creates a backend API key and returns its one-time token.
   *
   * @param context The backend authorization context.
   * @param input The API key definition.
   * @returns The created API key and token.
   */
  async create(
    context: BackendRequestContext,
    input: BackendApiKeyInput,
  ): Promise<BackendApiKeyTokenOutput> {
    requireBackendPermission(context, "api-key.create")

    const data = backendApiKeyInputSchema.parse(input)
    const serviceAccountId = data.serviceAccountId ?? (await this.getAdminServiceAccountId())
    await this.serviceAccounts.assertExists(serviceAccountId)
    await this.roles.validateReferences({ rules: data.restrictionRules })
    const effectiveRules = await this.validateRestrictions(serviceAccountId, data.restrictionRules)
    if (!hasBackendPermissionRulesSubset(context, effectiveRules)) {
      requireBackendPermission(context, "api-key.escalate")
    }

    return await this.database.backend.$transaction(async transaction => {
      const created = await transaction.backendApiKey.create({
        data: { ...data, serviceAccountId },
      })

      const { token } = await rotateBackendApiKeyToken(transaction, created.id)
      const apiKey = await transaction.backendApiKey.findUniqueOrThrow({
        where: { id: created.id },
        include: BackendApiKeySettingsService.include(),
      })

      return { apiKey: BackendApiKeySettingsService.toOutput(apiKey), token }
    })
  }

  /**
   * Updates an existing backend API key.
   *
   * @param context The backend authorization context.
   * @param apiKeyId The API key ID.
   * @param input The replacement API key definition.
   * @returns The updated API key.
   */
  async update(
    context: BackendRequestContext,
    apiKeyId: string,
    input: BackendApiKeyInput,
  ): Promise<BackendApiKeyOutput> {
    requireBackendPermission(context, "api-key.update", { resourceId: apiKeyId })

    await this.assertExists(apiKeyId)
    const data = backendApiKeyInputSchema.parse(input)
    if (!hasBackendPermissionRulesSubset(context, data.restrictionRules)) {
      requireBackendPermission(context, "api-key.escalate", { resourceId: apiKeyId })
    }
    const serviceAccountId = data.serviceAccountId ?? (await this.getAdminServiceAccountId())
    await this.serviceAccounts.assertExists(serviceAccountId)
    await this.roles.validateReferences({ rules: data.restrictionRules })
    const effectiveRules = await this.validateRestrictions(serviceAccountId, data.restrictionRules)
    if (!hasBackendPermissionRulesSubset(context, effectiveRules)) {
      requireBackendPermission(context, "api-key.escalate", { resourceId: apiKeyId })
    }

    const apiKey = await this.database.backend.backendApiKey.update({
      where: { id: apiKeyId },
      data: { ...data, serviceAccountId },
      include: BackendApiKeySettingsService.include(),
    })

    return BackendApiKeySettingsService.toOutput(apiKey)
  }

  /**
   * Deletes an existing backend API key.
   *
   * @param context The backend authorization context.
   * @param apiKeyId The API key ID.
   */
  async delete(context: BackendRequestContext, apiKeyId: string): Promise<void> {
    requireBackendPermission(context, "api-key.delete", { resourceId: apiKeyId })

    await this.assertExists(apiKeyId)
    await this.database.backend.backendApiKey.delete({ where: { id: apiKeyId } })
  }

  /**
   * Gets service accounts available for backend API key ownership.
   *
   * @param context The backend authorization context.
   * @returns The service account options and effective rules.
   */
  async getServiceAccountOptions(
    context: BackendRequestContext,
  ): Promise<BackendApiKeyServiceAccountOption[]> {
    const authorization = await buildBackendAuthorizationWhere({
      database: this.database,
      context,
      permission: "service-account.list",
      target: {
        resources: serviceAccountIds => ({ id: { in: [...serviceAccountIds] } }),
      },
    })
    const roleAuthorization = await buildBackendAuthorizationWhere({
      database: this.database,
      context,
      permission: "role.list",
      target: {
        resources: roleIds => ({ id: { in: [...roleIds] } }),
      },
    })
    const accounts = await this.database.backend.backendServiceAccount.findMany({
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

  private async validateRestrictions(
    serviceAccountId: string,
    rules: BackendApiKeyOutput["restrictionRules"],
  ): Promise<BackendRoleRules> {
    const bindings = await this.database.backend.serviceAccountBackendRoleBinding.findMany({
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

  private async assertExists(apiKeyId: string): Promise<void> {
    const apiKey = await this.database.backend.backendApiKey.findUnique({
      where: { id: apiKeyId },
      select: { id: true },
    })

    if (!apiKey) {
      throw new BackendApiKeyNotFoundError(apiKeyId)
    }
  }

  private async getAdminServiceAccountId(): Promise<string> {
    const account = await this.database.backend.backendServiceAccount.findUnique({
      where: { systemName: adminBackendServiceAccount.systemName },
      select: { id: true },
    })

    if (!account) {
      throw new RequiredSystemResourceNotFoundError("admin-backend-service-account")
    }

    return account.id
  }

  private static include() {
    return { serviceAccount: { select: { meta: true } } } as const
  }

  private static toOutput(apiKey: {
    id: string
    meta: BackendApiKeyOutput["meta"]
    serviceAccountId: string
    restrictionRules: BackendApiKeyOutput["restrictionRules"]
    expiresAt: Date | null
    lastUsedAt: Date | null
    createdAt: Date
    updatedAt: Date
    serviceAccount: { meta: BackendApiKeyOutput["serviceAccountMeta"] }
  }): BackendApiKeyOutput {
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
    }
  }
}
