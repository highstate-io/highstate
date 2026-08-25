import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, PageWhereInput } from "../../../database"
import type { PageDetailsOutput, PageOutput, PageQuery, PageResult } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, pageDetailsOutputSchema, pageOutputSchema, toPageOutput } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class PageSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(context: ProjectRequestContext, query: PageQuery): Promise<PageResult<PageOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = PageSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<PageWhereInput>({
      database: this.database,
      context,
      permission: "page.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
      },
    })

    return await querySettingsPage({
      collection: "pages",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) => {
        const pages = await database.page.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: {
            ...forSchema(pageOutputSchema.omit({ serviceAccountMeta: true })),
            serviceAccount: { select: { meta: true } },
          },
        })

        return pages.map(page => toPageOutput(page, page.serviceAccount))
      },
    })
  }

  async get(context: ProjectRequestContext, pageId: string): Promise<PageDetailsOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const page = await database.page.findUnique({
      where: { id: pageId },
      select: {
        ...forSchema(pageDetailsOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: { select: { meta: true } },
        state: { select: { instanceId: true } },
      },
    })

    if (!page) {
      return null
    }

    requireProjectPermission(context, "page.get", {
      resourceId: page.id,
      instanceId: page.state?.instanceId,
      ownerServiceAccountId: page.serviceAccountId ?? undefined,
    })

    return { ...toPageOutput(page, page.serviceAccount), content: page.content }
  }

  private static buildWhere(query: PageQuery): PageWhereInput {
    return {
      ...(query.serviceAccountId ? { serviceAccountId: query.serviceAccountId } : {}),
      ...(query.stateId ? { stateId: query.stateId } : {}),
      ...(query.artifactId ? { artifacts: { some: { id: query.artifactId } } } : {}),
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
