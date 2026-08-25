import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, PanelWhereInput } from "../../../database"
import type { PanelEndpointManager } from "../../../panel"
import type { PageResult, PanelOutput, PanelQuery } from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import { forSchema, panelOutputSchema } from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class PanelSettingsService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly panelEndpointManager: PanelEndpointManager,
  ) {}

  async query(context: ProjectRequestContext, query: PanelQuery): Promise<PageResult<PanelOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = PanelSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<PanelWhereInput>({
      database: this.database,
      context,
      permission: "panel.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
        workers: ids => ({ workerVersion: { workerId: { in: [...ids] } } }),
      },
    })

    return await querySettingsPage({
      collection: "panels",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.panel.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: PanelSettingsService.select(),
        }),
      map: panel =>
        panelOutputSchema.parse({
          ...panel,
          serviceAccountMeta: panel.serviceAccount.meta,
          workerVersionMeta: panel.workerVersion.meta,
          workerId: panel.workerVersion.workerId,
          online: this.panelEndpointManager.isPanelAvailable(
            context.projectId,
            panel.workerVersionId,
            panel.id,
          ),
        }),
    })
  }

  async get(context: ProjectRequestContext, panelId: string): Promise<PanelOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const panel = await database.panel.findUnique({
      where: { id: panelId },
      select: PanelSettingsService.select(),
    })

    if (!panel) {
      return null
    }

    requireProjectPermission(context, "panel.get", {
      resourceId: panel.id,
      ownerServiceAccountId: panel.serviceAccountId,
      workerId: panel.workerVersion.workerId,
    })

    return panelOutputSchema.parse({
      ...panel,
      serviceAccountMeta: panel.serviceAccount.meta,
      workerVersionMeta: panel.workerVersion.meta,
      workerId: panel.workerVersion.workerId,
      online: this.panelEndpointManager.isPanelAvailable(
        context.projectId,
        panel.workerVersionId,
        panel.id,
      ),
    })
  }

  private static buildWhere(query: PanelQuery): PanelWhereInput {
    return {
      ...(query.stateId ? { stateId: query.stateId } : {}),
      ...(query.serviceAccountId ? { serviceAccountId: query.serviceAccountId } : {}),
      ...(query.workerVersionId ? { workerVersionId: query.workerVersionId } : {}),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search } },
              { name: { contains: query.search } },
              { meta: { path: "title", string_contains: query.search } },
            ],
          }
        : {}),
    }
  }

  private static select() {
    return {
      ...forSchema(
        panelOutputSchema.omit({
          serviceAccountMeta: true,
          workerVersionMeta: true,
          workerId: true,
          online: true,
        }),
      ),
      serviceAccount: { select: { meta: true } },
      workerVersion: { select: { meta: true, workerId: true } },
    } as const
  }
}
