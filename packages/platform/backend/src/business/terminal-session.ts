import type { ProjectRequestContext } from "../common"
import type { DatabaseManager, TerminalSessionLog, TerminalWhereInput } from "../database"
import { buildProjectAuthorizationWhere } from "../common"
import { PermissionDeniedError } from "../shared"
import {
  type TerminalSessionOutput,
  toTerminalSessionOutput,
} from "../shared/models/project/terminal"

/**
 * Business service for managing terminal sessions
 */
export class TerminalSessionService {
  constructor(private readonly database: DatabaseManager) {}

  /**
   * Returns only terminals visible to the caller, including recursive instance scopes.
   */
  async getTerminals(context: ProjectRequestContext, terminalIds: string[]) {
    const database = await this.database.forProject(context.projectId)
    const authorization = await this.terminalAuthorization(context, "terminal.get")

    return await database.terminal.findMany({
      where: { AND: [{ id: { in: terminalIds } }, authorization] },
    })
  }

  /**
   * Authorizes a terminal connection before the runtime manager creates a session.
   */
  async authorizeConnection(context: ProjectRequestContext, terminalId: string): Promise<void> {
    const database = await this.database.forProject(context.projectId)
    const authorization = await this.terminalAuthorization(context, "terminal.connect")

    const terminal = await database.terminal.findFirst({
      where: { AND: [{ id: terminalId }, authorization] },
      select: { id: true },
    })

    if (!terminal) {
      throw new PermissionDeniedError("terminal.connect")
    }
  }

  private async terminalAuthorization(
    context: ProjectRequestContext,
    permission: "terminal.get" | "terminal.connect",
  ): Promise<TerminalWhereInput> {
    return await buildProjectAuthorizationWhere<TerminalWhereInput>({
      database: this.database,
      context,
      permission,
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({ stateId: { in: [...scope.stateIds] } }),
        owners: ids => ({ serviceAccountId: { in: [...ids] } }),
        self: id => ({ serviceAccountId: id }),
      },
    })
  }

  /**
   * Get terminal sessions for a specific instance
   *
   * @param projectId The project ID
   * @param stateId The state ID to get sessions for
   * @returns Array of terminal session outputs with metadata
   */
  async getInstanceTerminalSessions(
    context: ProjectRequestContext,
    stateId: string,
  ): Promise<TerminalSessionOutput[]> {
    const database = await this.database.forProject(context.projectId)

    const state = await database.instanceState.findUnique({
      where: { id: stateId },
      select: { instanceId: true },
    })

    if (!state) {
      return []
    }

    const authorization = await this.terminalAuthorization(context, "terminal.get")

    const sessions = await database.terminalSession.findMany({
      include: {
        terminal: {
          select: { meta: true },
        },
      },
      where: {
        terminal: {
          AND: [{ stateId }, authorization],
        },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    })

    return sessions.map(session => ({
      ...session,
      projectId: context.projectId,
      meta: session.terminal.meta,
    }))
  }

  /**
   * Get a specific terminal session by ID
   *
   * @param projectId The project ID
   * @param sessionId The session ID to get
   * @returns Terminal session output with metadata or null if not found
   */
  async getTerminalSession(
    context: ProjectRequestContext,
    sessionId: string,
  ): Promise<TerminalSessionOutput | null> {
    const database = await this.database.forProject(context.projectId)

    const session = await database.terminalSession.findUnique({
      where: { id: sessionId },
      include: {
        terminal: true,
      },
    })

    if (!session) {
      return null
    }

    const terminals = await this.getTerminals(context, [session.terminal.id])
    if (terminals.length === 0) {
      throw new PermissionDeniedError("terminal.get")
    }

    return toTerminalSessionOutput(session.terminal, session)
  }

  /**
   * Get session history (logs) for a specific terminal session
   *
   * @param projectId The project ID
   * @param sessionId The session ID to get history for
   * @returns Array of session logs ordered by creation time
   */
  async getSessionHistory(
    context: ProjectRequestContext,
    sessionId: string,
  ): Promise<TerminalSessionLog[]> {
    const database = await this.database.forProject(context.projectId)

    const session = await database.terminalSession.findUnique({
      where: { id: sessionId },
      select: { terminal: { select: { id: true, serviceAccountId: true } } },
    })

    if (!session) {
      return []
    }

    const terminals = await this.getTerminals(context, [session.terminal.id])
    if (terminals.length === 0) {
      throw new PermissionDeniedError("terminal.get")
    }

    return await database.terminalSessionLog.findMany({
      where: { sessionId },
      orderBy: { id: "asc" },
    })
  }
}
