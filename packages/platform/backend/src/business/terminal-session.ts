import type { DatabaseManager, TerminalSessionLog } from "../database"
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
   * Get terminal sessions for a specific instance
   *
   * @param projectId The project ID
   * @param stateId The state ID to get sessions for
   * @returns Array of terminal session outputs with metadata
   */
  async getInstanceTerminalSessions(
    projectId: string,
    stateId: string,
  ): Promise<TerminalSessionOutput[]> {
    const database = await this.database.forProject(projectId)

    const sessions = await database.terminalSession.findMany({
      include: {
        terminal: {
          select: { meta: true },
        },
      },
      where: {
        terminal: {
          stateId,
        },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    })

    return sessions.map(session => ({
      ...session,
      projectId,
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
    projectId: string,
    sessionId: string,
  ): Promise<TerminalSessionOutput | null> {
    const database = await this.database.forProject(projectId)

    const session = await database.terminalSession.findUnique({
      where: { id: sessionId },
      include: {
        terminal: true,
      },
    })

    if (!session) {
      return null
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
  async getSessionHistory(projectId: string, sessionId: string): Promise<TerminalSessionLog[]> {
    const database = await this.database.forProject(projectId)

    return await database.terminalSessionLog.findMany({
      where: { sessionId },
      orderBy: { id: "asc" },
    })
  }
}
