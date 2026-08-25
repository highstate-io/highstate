import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, WorkerVersionWhereInput, WorkerWhereInput } from "../../../database"
import type {
  CollectionQuery,
  PageResult,
  WorkerOutput,
  WorkerQuery,
  WorkerVersionOutput,
} from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import {
  forSchema,
  toWorkerOutput,
  toWorkerVersionOutput,
  workerOutputSchema,
  workerVersionOutputSchema,
} from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class WorkerSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: WorkerQuery,
  ): Promise<PageResult<WorkerOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = WorkerSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<WorkerWhereInput>({
      database: this.database,
      context,
      permission: "worker.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
        workers: ids => ({ id: { in: [...ids] } }),
      },
    })

    return await querySettingsPage({
      collection: "workers",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) => {
        const workers = await database.worker.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: WorkerSettingsService.workerSelect(),
        })

        return workers.map(worker =>
          toWorkerOutput(worker, worker.versions[0] ?? null, worker.serviceAccount),
        )
      },
    })
  }

  async get(context: ProjectRequestContext, workerId: string): Promise<WorkerOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const worker = await database.worker.findUnique({
      where: { id: workerId },
      select: WorkerSettingsService.workerSelect(),
    })

    if (!worker) {
      return null
    }

    requireProjectPermission(context, "worker.get", {
      resourceId: worker.id,
      ownerServiceAccountId: worker.serviceAccountId,
      workerId: worker.id,
    })

    return toWorkerOutput(worker, worker.versions[0] ?? null, worker.serviceAccount)
  }

  async queryVersions(
    context: ProjectRequestContext,
    workerId: string,
    query: CollectionQuery,
  ): Promise<PageResult<WorkerVersionOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = WorkerSettingsService.buildVersionWhere(workerId, query)

    const authorization = await buildProjectAuthorizationWhere<WorkerVersionWhereInput>({
      database: this.database,
      context,
      permission: "worker-version.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        workers: ids => ({ workerId: { in: [...ids] } }),
      },
    })

    const orderQuery =
      query.sortBy?.[0]?.key === "meta.title" ? { ...query, sortBy: undefined } : query

    return await querySettingsPage({
      collection: "worker-versions",
      request: query,
      query: { projectId: context.projectId, workerId, ...query },
      fetch: async ({ cursorId, take }) => {
        const versions = await database.workerVersion.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(orderQuery, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: WorkerSettingsService.versionSelect(),
        })

        return versions.map(version => toWorkerVersionOutput(version, version.apiKey))
      },
    })
  }

  async getVersion(
    context: ProjectRequestContext,
    versionId: string,
  ): Promise<WorkerVersionOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const version = await database.workerVersion.findUnique({
      where: { id: versionId },
      select: WorkerSettingsService.versionSelect(),
    })

    if (!version) {
      return null
    }

    requireProjectPermission(context, "worker-version.get", {
      resourceId: version.id,
      workerId: version.workerId,
    })

    return toWorkerVersionOutput(version, version.apiKey)
  }

  private static buildWhere(query: WorkerQuery): WorkerWhereInput {
    return {
      ...(query.serviceAccountId ? { serviceAccountId: query.serviceAccountId } : {}),
      ...(query.search
        ? { OR: [{ id: { contains: query.search } }, { identity: { contains: query.search } }] }
        : {}),
    }
  }

  private static buildVersionWhere(
    workerId: string,
    query: CollectionQuery,
  ): WorkerVersionWhereInput {
    return {
      workerId,
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search } },
              { meta: { path: "title", string_contains: query.search } },
              { digest: { contains: query.search } },
            ],
          }
        : {}),
    }
  }

  private static workerSelect() {
    return {
      ...forSchema(workerOutputSchema.omit({ meta: true, serviceAccountMeta: true })),
      serviceAccount: { select: { meta: true } },
      versions: { orderBy: { createdAt: "desc" as const }, take: 1, select: { meta: true } },
    }
  }

  private static versionSelect() {
    return {
      ...forSchema(workerVersionOutputSchema.omit({ apiKeyMeta: true })),
      workerId: true,
      apiKey: { select: { meta: true } },
    }
  }
}
