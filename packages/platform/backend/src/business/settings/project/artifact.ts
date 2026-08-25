import type { ProjectRequestContext } from "../../../common"
import type { ArtifactWhereInput, DatabaseManager } from "../../../database"
import type { ArtifactOutput, ArtifactQuery, PageResult } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { artifactOutputSchema, forSchema } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class ArtifactSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: ArtifactQuery,
  ): Promise<PageResult<ArtifactOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = ArtifactSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<ArtifactWhereInput>({
      database: this.database,
      context,
      permission: "artifact.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ instances: { some: { id: { in: [...scope.stateIds] } } } }),
        owners: ids => ({ serviceAccounts: { some: { id: { in: [...ids] } } } }),
        self: id => ({ serviceAccounts: { some: { id } } }),
      },
    })

    return await querySettingsPage({
      collection: "artifacts",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.artifact.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: forSchema(artifactOutputSchema),
        }),
    })
  }

  async get(context: ProjectRequestContext, artifactId: string): Promise<ArtifactOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const artifact = await database.artifact.findUnique({
      where: { id: artifactId },
      select: forSchema(artifactOutputSchema),
    })

    if (!artifact) {
      return null
    }

    requireProjectPermission(context, "artifact.get", { resourceId: artifact.id })

    return artifact
  }

  private static buildWhere(query: ArtifactQuery): ArtifactWhereInput {
    return {
      ...(query.stateId ? { instances: { some: { id: query.stateId } } } : {}),
      ...(query.serviceAccountId
        ? { serviceAccounts: { some: { id: query.serviceAccountId } } }
        : {}),
      ...(query.terminalId ? { terminals: { some: { id: query.terminalId } } } : {}),
      ...(query.pageId ? { pages: { some: { id: query.pageId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { meta: { path: "title", string_contains: query.search } },
              { hash: { contains: query.search } },
            ],
          }
        : {}),
    }
  }
}
