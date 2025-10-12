import type { Logger } from "pino"
import type { ApiKeyService, ProjectUnlockService } from "../business"
import type { DatabaseManager, Worker, WorkerVersion } from "../database"
import type { PubSubManager } from "../pubsub"
import type { WorkerBackend } from "./abstractions"
import { PassThrough } from "node:stream"
import { z } from "zod"
import { type AsyncBatcher, createAsyncBatcher } from "../shared"

export const workerManagerConfig = z.object({
  HIGHSTATE_WORKER_API_PATH: z.string().default("/var/run/highstate.sock"),
})

type RunningWorkerInfo = {
  abortController: AbortController
  projectId: string
  workerVersion: WorkerVersion & { worker: Worker }
  startedAt: Date
  failedAttempts: number
  status: "starting" | "running"
  logBatcher: AsyncBatcher<{ content: string; isSystem?: boolean }>
  lineBuffer?: string
}

export const maxWorkerStartAttempts = 5

export class WorkerManager {
  constructor(
    readonly config: z.infer<typeof workerManagerConfig>,
    private readonly runtimeId: string,
    private readonly workerBackend: WorkerBackend,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly apiKeyService: ApiKeyService,
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly logger: Logger,
  ) {
    this.projectUnlockService.registerUnlockTask(
      //
      "sync-workers",
      projectId => this.syncWorkers(projectId),
    )

    this.projectUnlockService.registerUnlockTask(
      //
      "clear-worker-logs",
      projectId => this.clearWorkerLogs(projectId),
    )
  }

  private readonly runningWorkers = new Map<string, RunningWorkerInfo>()

  private async startWorkerVersion(
    projectId: string,
    workerVersion: WorkerVersion & { worker: Worker },
    restart = false,
  ): Promise<void> {
    const existingInfo = this.runningWorkers.get(workerVersion.id)

    // check if already running
    if (existingInfo?.status === "running") {
      this.logger.debug(
        { projectId, workerVersionId: workerVersion.id },
        `worker version "%s" is already running, skipping start`,
        workerVersion.id,
      )
      return
    }

    // calculate attempt number
    const previousFailedAttempts = existingInfo?.failedAttempts ?? 0
    const failedAttempts = restart ? previousFailedAttempts + 1 : 0

    // check if max attempts reached
    if (failedAttempts >= maxWorkerStartAttempts) {
      this.logger.debug(
        { projectId, workerVersionId: workerVersion.id },
        `skipping worker version "%s" start attempt since maximum attempts reached`,
        workerVersion.id,
      )

      await this.writeWorkerLog(
        projectId,
        workerVersion.id,
        `maximum retry attempts (${maxWorkerStartAttempts}) exceeded, marking as error`,
      )

      // update status to error in database
      const database = await this.database.forProject(projectId)
      await database.workerVersion.update({
        where: { id: workerVersion.id },
        data: {
          status: "error",
          runtimeId: this.runtimeId,
        },
      })

      // clean up from running workers map
      if (existingInfo) {
        existingInfo.logBatcher && void existingInfo.logBatcher.flush()
        this.runningWorkers.delete(workerVersion.id)
      }

      return
    }

    // regenerate API token
    const apiKey = await this.apiKeyService.regenerateToken(projectId, workerVersion.apiKeyId)
    const stdout = new PassThrough()

    await this.writeWorkerLog(
      projectId,
      workerVersion.id,
      `starting worker container, attempt ${failedAttempts + 1}/${maxWorkerStartAttempts}`,
    )

    const database = await this.database.forProject(projectId)

    const logBatcher = createAsyncBatcher(
      async (entries: Array<{ content: string; isSystem?: boolean }>) => {
        this.logger.trace({ msg: "persisting worker log entries", count: entries.length })

        for (const entry of entries) {
          const log = await database.workerVersionLog.create({
            data: {
              workerVersionId: workerVersion.id,
              content: entry.content,
              isSystem: entry.isSystem ?? false,
            },
          })

          this.pubsubManager.publish(["worker-version-log", projectId, workerVersion.id], log)
        }
      },
    )

    const abortController = new AbortController()

    // create tracking info first
    const info: RunningWorkerInfo = {
      abortController,
      projectId,
      workerVersion,
      startedAt: new Date(),
      failedAttempts,
      status: "starting",
      logBatcher,
      lineBuffer: "",
    }

    // update tracking info
    this.runningWorkers.set(workerVersion.id, info)

    // buffer for incomplete lines
    stdout.on("data", chunk => {
      const text = (info.lineBuffer || "") + String(chunk)
      const lines = text.split("\n")

      // keep the last incomplete line in the buffer
      info.lineBuffer = lines.pop() || ""

      // process complete lines
      for (const line of lines) {
        if (line.trim()) {
          logBatcher.call({ content: line, isSystem: false })
        }
      }
    })

    // flush any remaining buffered line on close
    stdout.on("end", () => {
      if (info.lineBuffer?.trim()) {
        logBatcher.call({ content: info.lineBuffer, isSystem: false })
        info.lineBuffer = ""
      }
    })

    // update worker version status in database
    await database.workerVersion.update({
      where: { id: workerVersion.id },
      data: {
        status: "starting",
        runtimeId: this.runtimeId,
      },
    })

    void this.workerBackend
      .run({
        projectId,
        workerVersionId: workerVersion.id,
        image: `${workerVersion.worker.identity}@sha256:${workerVersion.digest}`,
        apiPath: this.config.HIGHSTATE_WORKER_API_PATH,
        apiKey: apiKey.token,
        stdout,
        signal: abortController.signal,
      })
      // regardless the exit reason, we want to restart the worker if it has remaining attempts
      .finally(async () => {
        const info = this.runningWorkers.get(workerVersion.id)

        if (info) {
          // flush any remaining line buffer
          if (info.lineBuffer?.trim()) {
            info.logBatcher.call({ content: info.lineBuffer, isSystem: false })
            info.lineBuffer = ""
          }

          void info.logBatcher.flush()

          // only log if it wasn't a manual stop
          if (!info.abortController.signal.aborted) {
            await this.writeWorkerLog(
              projectId,
              workerVersion.id,
              `worker container exited unexpectedly`,
            )
          }
        }

        // attempt restart if not manually aborted
        if (!info?.abortController.signal.aborted) {
          void this.startWorkerVersion(projectId, workerVersion, true)
        }
      })
  }

  private async writeWorkerLog(
    projectId: string,
    workerVersionId: string,
    message: string,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    const log = await database.workerVersionLog.create({
      data: {
        workerVersionId,
        content: message,
        isSystem: true, // runtime logs are always system logs
      },
    })

    this.pubsubManager.publish(["worker-version-log", projectId, workerVersionId], log)
  }

  async setWorkerRunning(projectId: string, workerVersionId: string): Promise<void> {
    const info = this.runningWorkers.get(workerVersionId)
    if (!info) {
      this.logger.warn(
        { projectId, workerVersionId },
        `worker version "%s" not found in running workers`,
        workerVersionId,
      )
      return
    }

    await this.writeWorkerLog(
      projectId,
      workerVersionId,
      `worker container started successfully and connected to runtime`,
    )

    info.status = "running"
    info.failedAttempts = 0

    // update worker version status in database
    const database = await this.database.forProject(projectId)
    await database.workerVersion.update({
      where: { id: workerVersionId },
      data: {
        status: "running",
        runtimeId: this.runtimeId,
      },
    })

    this.logger.debug(
      { projectId, workerVersionId },
      `worker version "%s" is now running in project "%s"`,
      workerVersionId,
      projectId,
    )
  }

  private async stopWorkerVersion(workerVersionId: string, reason = "manual stop"): Promise<void> {
    const info = this.runningWorkers.get(workerVersionId)
    if (!info) {
      this.logger.warn(
        { workerVersionId },
        `worker version "%s" is not running, cannot stop`,
        workerVersionId,
      )
      return
    }

    await this.writeWorkerLog(
      info.projectId,
      workerVersionId,
      `stopping worker container: ${reason}`,
    )

    info.abortController.abort()
    void info.logBatcher.flush()
    this.runningWorkers.delete(workerVersionId)

    // update worker version status in database
    const database = await this.database.forProject(info.projectId)
    await database.workerVersion.update({
      where: { id: workerVersionId },
      data: {
        status: "stopped",
        runtimeId: this.runtimeId,
      },
    })

    this.logger.debug(
      { projectId: info.projectId, workerVersionId },
      `stopped worker version "%s"`,
      workerVersionId,
    )
  }

  async restartWorkerVersion(projectId: string, workerVersionId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    // verify the worker version exists and belongs to this runtime
    const workerVersion = await database.workerVersion.findFirst({
      where: {
        id: workerVersionId,
        runtimeId: this.runtimeId,
      },
      include: {
        worker: true,
      },
    })

    if (!workerVersion) {
      this.logger.warn(
        { projectId, workerVersionId },
        `cannot restart worker version "%s" - not found or not owned by this runtime`,
        workerVersionId,
      )
      return
    }

    const existingInfo = this.runningWorkers.get(workerVersionId)

    await this.writeWorkerLog(projectId, workerVersionId, `restart requested by user`)

    if (existingInfo) {
      // stop the existing worker
      this.logger.debug(
        { projectId, workerVersionId },
        `stopping worker version "%s" for restart`,
        workerVersionId,
      )

      await this.writeWorkerLog(
        projectId,
        workerVersionId,
        `stopping current container for restart`,
      )

      existingInfo.abortController.abort()
      void existingInfo.logBatcher.flush()
      this.runningWorkers.delete(workerVersionId)
    } else {
      await this.writeWorkerLog(
        projectId,
        workerVersionId,
        `worker was not running, starting fresh`,
      )
    }

    // reset failed attempts and start fresh
    void this.startWorkerVersion(projectId, workerVersion, false)
  }

  async syncWorkers(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    // get all worker versions that exist (ones without registrations are already deleted)
    const workerVersions = await database.workerVersion.findMany({
      include: {
        worker: true,
        apiKey: true,
      },
    })

    // track which worker versions should be running
    const activeVersionIds = new Set(workerVersions.map(v => v.id))

    // stop workers that no longer exist in database
    for (const [versionId, info] of this.runningWorkers) {
      if (info.projectId !== projectId) continue

      if (!activeVersionIds.has(versionId)) {
        await this.stopWorkerVersion(versionId, "worker version removed from database")
      }
    }

    // start workers that aren't running
    for (const version of workerVersions) {
      if (!this.runningWorkers.has(version.id)) {
        void this.startWorkerVersion(projectId, version)
      }
    }

    this.logger.debug(
      { projectId, workerVersionCount: workerVersions.length },
      `synced %s worker versions for project "%s"`,
      workerVersions.length,
      projectId,
    )
  }

  private async clearWorkerLogs(projectId: string): Promise<void> {
    // keep only the last 1000 logs per worker version
    const database = await this.database.forProject(projectId)

    const workerVersions = await database.workerVersion.findMany({ select: { id: true } })

    for (const version of workerVersions) {
      const logsToDelete = await database.workerVersionLog.findMany({
        where: { workerVersionId: version.id },
        orderBy: { id: "desc" },
        skip: 1000,
        select: { id: true },
      })

      if (logsToDelete.length === 0) continue

      await database.workerVersionLog.deleteMany({
        where: { id: { in: logsToDelete.map(l => l.id) } },
      })
    }
  }
}
