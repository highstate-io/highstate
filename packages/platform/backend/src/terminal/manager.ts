import type { Logger } from "pino"
import type { ProjectUnlockService } from "../business"
import type { DatabaseManager, Terminal, TerminalSession } from "../database"
import type { PubSubManager } from "../pubsub"
import type { TerminalSessionOutput } from "../shared/models/project/terminal"
import type { ScreenSize, TerminalBackend } from "./abstractions"
import { PassThrough, type Stream, type Writable } from "node:stream"
import { v7 as uuidv7 } from "uuid"
import { isAbortErrorLike } from "../common"
import { type AsyncBatcher, createAsyncBatcher, toTerminalSessionOutput } from "../shared"

type ManagedTerminal = {
  readonly projectId: string

  readonly terminal: Terminal
  readonly session: TerminalSession

  readonly abortController: AbortController
  readonly stdin: PassThrough
  readonly stdout: PassThrough
  readonly logBatcher: AsyncBatcher<string>

  refCount: number
  started: boolean
  start(screenSize: ScreenSize): void
}

const notAttachedTerminalLifetime = 5 * 60 * 1000 // 5 minutes

export class TerminalManager {
  private readonly managedTerminals = new Map<string, ManagedTerminal>()

  private constructor(
    private readonly terminalBackend: TerminalBackend,
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly logger: Logger,
  ) {
    this.projectUnlockService.registerUnlockTask(
      //
      "mark-finished-terminal-sessions",
      projectId => this.markFinishedSessions(projectId),
    )
  }

  public isSessionActive(sessionId: string): boolean {
    return this.managedTerminals.has(sessionId)
  }

  public async *watchSession(
    projectId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): AsyncIterable<TerminalSessionOutput> {
    const managedTerminal = this.managedTerminals.get(sessionId)

    // if terminal session is not active, just fetch it, return and stop watching
    if (!managedTerminal) {
      const database = await this.database.forProject(projectId)
      const session = await database.terminalSession.findUnique({
        where: { id: sessionId },
        include: { terminal: true },
      })

      if (!session) {
        throw new Error(`Terminal session "${sessionId}" not found`)
      }

      const terminalSessionOutput: TerminalSessionOutput = {
        ...session,
        meta: session.terminal?.meta,
      }

      yield terminalSessionOutput
      return
    }

    yield toTerminalSessionOutput(managedTerminal.terminal, managedTerminal.session)

    for await (const terminalSession of await this.pubsubManager.subscribe(
      ["active-terminal-session", projectId, sessionId],
      signal,
    )) {
      yield terminalSession

      if (terminalSession.finishedAt) {
        // terminal session is finished, stop watching
        return
      }
    }
  }

  public async createSession(
    projectId: string,
    terminalId: string,
  ): Promise<TerminalSessionOutput> {
    const database = await this.database.forProject(projectId)

    // get the terminal info from database
    const terminal = await database.terminal.findUnique({
      where: { id: terminalId },
    })

    if (!terminal) {
      throw new Error(`Terminal "${terminalId}" not found`)
    }

    const sessionId = uuidv7()

    // create the terminal session in database
    const session = await database.terminalSession.create({
      data: {
        id: sessionId,
        terminalId,
      },
    })

    const output = toTerminalSessionOutput(terminal, session)

    this.logger.info({ msg: "terminal session created", id: output.id })

    this.createManagedTerminal(projectId, terminal, session)

    return output
  }

  public async getOrCreateSession(
    projectId: string,
    terminalId: string,
    newSession = false,
  ): Promise<TerminalSessionOutput> {
    // find if there's already an active session for this terminal
    if (!newSession) {
      for (const managedTerminal of this.managedTerminals.values()) {
        if (
          managedTerminal.projectId === projectId &&
          managedTerminal.session.terminalId === terminalId
        ) {
          return toTerminalSessionOutput(managedTerminal.terminal, managedTerminal.session)
        }
      }
    }

    return await this.createSession(projectId, terminalId)
  }

  public close(sessionId: string): void {
    this.logger.info({ msg: "closing terminal session", id: sessionId })

    const managedTerminal = this.managedTerminals.get(sessionId)

    if (managedTerminal) {
      managedTerminal.abortController.abort()
    }
  }

  public attach(
    sessionId: string,
    stdin: Stream,
    stdout: Writable,
    screenSize: ScreenSize,
    signal: AbortSignal,
  ): void {
    const terminal = this.managedTerminals.get(sessionId)
    if (!terminal) {
      throw new Error(`Terminal session "${sessionId}" not found, check if it's still active`)
    }

    const handleStdin = (data: unknown) => {
      terminal.stdin.write(data)
    }

    const handleStdout = (data: unknown) => {
      stdout.write(data)
    }

    terminal.stdout.on("data", handleStdout)
    stdin.on("data", handleStdin)

    terminal.refCount += 1

    this.logger.info(
      "terminal attached (sessionId: %s, refCount: %d)",
      sessionId,
      terminal.refCount,
    )

    signal.addEventListener("abort", () => {
      terminal.refCount -= 1
      terminal.stdout.off("data", handleStdout)
      stdin.off("data", handleStdin)

      this.logger.info(
        "terminal detached (sessionId: %s, refCount: %d)",
        sessionId,
        terminal.refCount,
      )
    })

    if (!terminal.started) {
      terminal.start(screenSize)
      terminal.started = true
    }
  }

  private createManagedTerminal(
    projectId: string,
    terminal: Terminal,
    session: TerminalSession,
  ): ManagedTerminal {
    const managedTerminal: ManagedTerminal = {
      projectId,
      terminal,
      session,

      abortController: new AbortController(),
      stdin: new PassThrough(),
      stdout: new PassThrough(),

      logBatcher: createAsyncBatcher(async (entries: string[]) => {
        this.logger.trace({ msg: "persisting terminal log entries", count: entries.length })

        const database = await this.database.forProject(projectId)

        await database.terminalSessionLog.createMany({
          data: entries.map(entry => ({
            id: uuidv7(),
            sessionId: session.id,
            content: entry,
          })),
        })
      }),

      refCount: 0,
      started: false,

      start: (screenSize: ScreenSize) => {
        void this.terminalBackend
          .run({
            spec: terminal.spec,
            stdin: managedTerminal.stdin,
            stdout: managedTerminal.stdout,
            screenSize,
            signal: managedTerminal.abortController.signal,
          })
          .catch(error => {
            if (isAbortErrorLike(error)) {
              return
            }

            this.logger.error({
              msg: "managed terminal failed",
              id: managedTerminal.session.id,
              error: error as unknown,
            })
          })
          .finally(() => {
            this.logger.info({ msg: "managed terminal closed", id: managedTerminal.session.id })
            this.managedTerminals.delete(managedTerminal.session.id)

            managedTerminal.session.finishedAt = new Date()

            void this.pubsubManager.publish(
              ["active-terminal-session", managedTerminal.projectId, managedTerminal.session.id],
              toTerminalSessionOutput(managedTerminal.terminal, managedTerminal.session),
            )

            // update session with finished timestamp
            void this.database.forProject(managedTerminal.projectId).then(database => {
              return database.terminalSession.update({
                where: { id: managedTerminal.session.id },
                data: { finishedAt: managedTerminal.session.finishedAt },
              })
            })

            void managedTerminal.logBatcher.flush()
          })

        setTimeout(
          () => this.closeTerminalIfNotAttached(managedTerminal),
          notAttachedTerminalLifetime,
        )

        this.logger.info({ msg: "managed terminal created", id: managedTerminal.session.id })
      },
    }

    managedTerminal.stdout.on("data", data => {
      const entry = String(data)

      managedTerminal.logBatcher.call(entry)
    })

    this.managedTerminals.set(managedTerminal.session.id, managedTerminal)

    return managedTerminal
  }

  private closeTerminalIfNotAttached(terminal: ManagedTerminal) {
    if (!this.managedTerminals.has(terminal.session.id)) {
      // Already closed
      return
    }

    if (terminal.refCount <= 0) {
      this.logger.info({
        msg: "terminal not attached for too long, closing",
        id: terminal.session.id,
      })

      terminal.abortController.abort()
      this.managedTerminals.delete(terminal.session.id)
      return
    }

    setTimeout(() => this.closeTerminalIfNotAttached(terminal), notAttachedTerminalLifetime)
  }

  static create(
    terminalBackend: TerminalBackend,
    database: DatabaseManager,
    pubsubManager: PubSubManager,
    projectUnlockService: ProjectUnlockService,
    logger: Logger,
  ): TerminalManager {
    return new TerminalManager(
      terminalBackend,
      database,
      pubsubManager,
      projectUnlockService,
      logger.child({ service: "TerminalManager" }),
    )
  }

  private async markFinishedSessions(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    // find all sessions without finishedAt timestamp that are not currently managed
    const activeSessions = await database.terminalSession.findMany({
      where: {
        finishedAt: null,
      },
    })

    if (activeSessions.length === 0) {
      this.logger.debug({ projectId }, "no lost terminal sessions found")
      return
    }

    // mark sessions as finished if they're not currently managed
    for (const session of activeSessions) {
      if (this.managedTerminals.has(session.id)) {
        continue
      }

      await database.terminalSession.update({
        where: { id: session.id },
        data: { finishedAt: new Date() },
      })
    }

    this.logger.debug(
      { projectId, count: activeSessions.length },
      "marked terminal sessions as finished",
    )
  }
}
