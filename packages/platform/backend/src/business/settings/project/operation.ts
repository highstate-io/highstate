import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, OperationWhereInput } from "../../../database"
import type { CollectionQuery, OperationOutput, OperationType, PageResult } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, operationOutputSchema } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class OperationSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: CollectionQuery,
  ): Promise<PageResult<OperationOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = OperationSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<OperationWhereInput>({
      database: this.database,
      context,
      permission: "operation.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({
          operationStates: { some: { stateId: { in: [...scope.stateIds] } } },
        }),
      },
    })

    return await querySettingsPage({
      collection: "settings-operations",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.operation.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "startedAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: forSchema(operationOutputSchema),
        }),
    })
  }

  async get(context: ProjectRequestContext, operationId: string): Promise<OperationOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const operation = await database.operation.findUnique({
      where: { id: operationId },
      select: forSchema(operationOutputSchema),
    })

    if (!operation) {
      return null
    }

    requireProjectPermission(context, "operation.get", { resourceId: operation.id })

    return operation
  }

  private static buildWhere(query: CollectionQuery): OperationWhereInput {
    if (!query.search) {
      return {}
    }

    const search = query.search.toLowerCase()
    const OR: OperationWhereInput[] = [{ meta: { path: "title", string_contains: query.search } }]
    const types = ["update", "preview", "destroy", "recreate", "refresh"].filter(type =>
      type.includes(search),
    ) as OperationType[]

    if (types.length > 0) {
      OR.push({ type: { in: types } })
    }

    return { OR }
  }
}
