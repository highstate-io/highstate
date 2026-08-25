import type { CommonObjectMeta } from "@highstate/contract"
import type { ProjectRequestContext } from "../../../common"
import type { DatabaseManager, TerminalWhereInput } from "../../../database"
import type {
  CollectionQuery,
  PageResult,
  TerminalDetailsOutput,
  TerminalOutput,
  TerminalQuery,
  TerminalSessionOutput,
} from "../../../shared"
import { buildProjectAuthorizationWhere, requireProjectPermission } from "../../../common"
import {
  forSchema,
  terminalDetailsOutputSchema,
  terminalOutputSchema,
  toTerminalDetailsOutput,
  toTerminalOutput,
} from "../../../shared"
import { querySettingsPage } from "../shared"
import { buildSettingsOrderBy } from "./shared"

export class TerminalSettingsService {
  constructor(private readonly database: DatabaseManager) {}

  async query(
    context: ProjectRequestContext,
    query: TerminalQuery,
  ): Promise<PageResult<TerminalOutput>> {
    const database = await this.database.forProject(context.projectId)
    const where = TerminalSettingsService.buildWhere(query)

    const authorization = await buildProjectAuthorizationWhere<TerminalWhereInput>({
      database: this.database,
      context,
      permission: "terminal.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
      },
    })

    return await querySettingsPage({
      collection: "terminals",
      request: query,
      query: { projectId: context.projectId, ...query },
      fetch: async ({ cursorId, take }) => {
        const terminals = await database.terminal.findMany({
          where: { AND: [where, authorization] },
          orderBy: buildSettingsOrderBy(query, "createdAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
          select: {
            ...forSchema(terminalOutputSchema.omit({ serviceAccountMeta: true })),
            serviceAccount: { select: { meta: true } },
          },
        })

        return terminals.map(item => toTerminalOutput(item, item.serviceAccount))
      },
    })
  }

  async get(
    context: ProjectRequestContext,
    terminalId: string,
  ): Promise<TerminalDetailsOutput | null> {
    const database = await this.database.forProject(context.projectId)
    const terminal = await database.terminal.findUnique({
      where: { id: terminalId },
      select: {
        ...forSchema(terminalDetailsOutputSchema.omit({ serviceAccountMeta: true })),
        serviceAccount: { select: { meta: true } },
      },
    })

    if (!terminal) {
      return null
    }

    requireProjectPermission(context, "terminal.get", {
      resourceId: terminal.id,
      ownerServiceAccountId: terminal.serviceAccountId ?? undefined,
    })

    return toTerminalDetailsOutput(terminal, terminal.serviceAccount)
  }

  async querySessions(
    context: ProjectRequestContext,
    terminalId: string,
    query: CollectionQuery,
  ): Promise<PageResult<TerminalSessionOutput>> {
    const database = await this.database.forProject(context.projectId)
    const terminal = await database.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, serviceAccountId: true },
    })

    if (!terminal) {
      return { items: [] }
    }

    requireProjectPermission(context, "terminal.get", {
      resourceId: terminal.id,
      ownerServiceAccountId: terminal.serviceAccountId ?? undefined,
    })

    const where = {
      terminalId,
      ...(query.search ? { id: { contains: query.search } } : {}),
    }
    return await querySettingsPage({
      collection: "terminal-sessions",
      request: query,
      query: { projectId: context.projectId, terminalId, ...query },
      fetch: async ({ cursorId, take }) =>
        await database.terminalSession.findMany({
          where,
          include: { terminal: { select: { meta: true } } },
          orderBy: buildSettingsOrderBy(query, "startedAt"),
          cursor: cursorId ? { id: cursorId } : undefined,
          skip: cursorId ? 1 : 0,
          take,
        }),
      map: session => ({
        id: session.id,
        terminalId: session.terminalId,
        meta: session.terminal.meta as CommonObjectMeta,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
      }),
    })
  }

  private static buildWhere(query: TerminalQuery): TerminalWhereInput {
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
