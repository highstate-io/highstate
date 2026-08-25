import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, SecretWhereInput } from "../../../database"
import type { PageResult, SecretOutput, SecretQuery } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, secretOutputSchema, toSecretOutput } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class SecretSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: SecretQuery,
  ): Promise<PageResult<SecretOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = SecretSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<SecretWhereInput>({
      database: this.database,
      context,
      permission: "secret.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
      },
    })

    return await querySettingsPage({
      collection: "secrets",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) => {
        const secrets = await database.secret.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: {
            ...forSchema(secretOutputSchema.omit({ serviceAccountMeta: true })),
            serviceAccount: { select: { meta: true } },
          },
        })

        return secrets.map(secret => toSecretOutput(secret, secret.serviceAccount))
      },
    })
  }

  async get(context: ProjectRequestContext, secretId: string): Promise<SecretOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const secret = await database.secret.findUnique({
      where: { id: secretId },
      select: {
        ...forSchema(secretOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: { select: { meta: true } },
      },
    })

    if (!secret) {
      return null
    }

    requireProjectPermission(context, "secret.metadata.get", {
      resourceId: secret.id,
      ownerServiceAccountId: secret.serviceAccountId ?? undefined,
    })

    return toSecretOutput(secret, secret.serviceAccount)
  }

  async getValue(context: ProjectRequestContext, secretId: string): Promise<unknown> {
    const database = await this.database.forProject(context.projectId)
    const secret = await database.secret.findUnique({
      where: { id: secretId },
      select: { id: true, content: true, serviceAccountId: true },
    })

    if (!secret) {
      return null
    }

    requireProjectPermission(context, "secret.value.get", {
      resourceId: secret.id,
      ownerServiceAccountId: secret.serviceAccountId ?? undefined,
    })

    return secret.content
  }

  private static buildWhere(query: SecretQuery): SecretWhereInput {
    return {
      ...(query.serviceAccountId ? { serviceAccountId: query.serviceAccountId } : {}),
      ...(query.stateId ? { stateId: query.stateId } : {}),
      ...(query.search
        ? {
            OR: [
              { meta: { path: "title", string_contains: query.search } },
              { name: { contains: query.search } },
            ],
          }
        : {}),
    }
  }
}
