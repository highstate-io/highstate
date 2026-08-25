import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, UnlockMethodWhereInput } from "../../../database"
import type {
  CollectionQuery,
  PageResult,
  UnlockMethodInput,
  UnlockMethodOutput,
} from "../../../shared"
import type { ProjectUnlockService } from "../../project-unlock"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, unlockMethodOutputSchema } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class UnlockMethodSettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly projectUnlockService: ProjectUnlockService,
  ) {}

  async query(
    context: ProjectRequestContext,
    query: CollectionQuery,
  ): Promise<PageResult<UnlockMethodOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = UnlockMethodSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere({
      database: this.database,
      context,
      permission: "unlock-method.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
      },
    })

    return await querySettingsPage({
      collection: "unlock-methods",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.unlockMethod.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: forSchema(unlockMethodOutputSchema),
        }),
    })
  }

  async get(
    context: ProjectRequestContext,
    unlockMethodId: string,
  ): Promise<UnlockMethodOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const method = await database.unlockMethod.findUnique({
      where: { id: unlockMethodId },
      select: forSchema(unlockMethodOutputSchema),
    })

    if (!method) {
      return null
    }

    requireProjectPermission(context, "unlock-method.get", { resourceId: method.id })

    return method
  }

  async create(context: ProjectRequestContext, input: UnlockMethodInput): Promise<void> {
    requireProjectPermission(context, "unlock-method.create")

    await this.projectUnlockService.addProjectUnlockMethod(context.projectId, input)
  }

  async delete(context: ProjectRequestContext, unlockMethodId: string): Promise<void> {
    requireProjectPermission(context, "unlock-method.delete", { resourceId: unlockMethodId })

    await this.projectUnlockService.removeProjectUnlockMethod(context.projectId, unlockMethodId)
  }

  private static buildWhere(query: CollectionQuery): UnlockMethodWhereInput {
    if (!query.search) {
      return {}
    }

    const search = query.search.toLowerCase()
    const OR: UnlockMethodWhereInput[] = [
      { meta: { path: "title", string_contains: query.search } },
    ]
    const types = ["password", "passkey"].filter(type => type.includes(search)) as (
      | "password"
      | "passkey"
    )[]

    if (types.length > 0) {
      OR.push({ type: { in: types } })
    }

    return { OR }
  }
}
