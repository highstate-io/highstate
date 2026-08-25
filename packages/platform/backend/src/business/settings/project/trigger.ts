import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, TriggerWhereInput } from "../../../database"
import type { PageResult, TriggerOutput, TriggerQuery } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, triggerOutputSchema } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class TriggerSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: TriggerQuery,
  ): Promise<PageResult<TriggerOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = TriggerSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<TriggerWhereInput>({
      database: this.database,
      context,
      permission: "trigger.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
      },
    })

    return await querySettingsPage({
      collection: "triggers",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.trigger.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: forSchema(triggerOutputSchema),
        }),
    })
  }

  async get(context: ProjectRequestContext, triggerId: string): Promise<TriggerOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const trigger = await database.trigger.findUnique({
      where: { id: triggerId },
      select: forSchema(triggerOutputSchema),
    })

    if (!trigger) {
      return null
    }

    requireProjectPermission(context, "trigger.get", { resourceId: trigger.id })

    return trigger
  }

  private static buildWhere(query: TriggerQuery): TriggerWhereInput {
    return {
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
