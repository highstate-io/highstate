import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { RuntimeCoordinator } from "./coordinator"

/**
 * Reconciles durable runtime ownership even when no client is connected.
 */
export class RuntimeMaintenance implements AsyncDisposable {
  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setInterval>
  private pending: Promise<void> | undefined

  constructor(
    private readonly database: DatabaseManager,
    private readonly coordinator: RuntimeCoordinator,
    private readonly logger: Logger,
  ) {
    this.timer = setInterval(() => {
      void this.reconcile()
    }, 10_000)

    this.timer.unref()
  }

  async reconcile(): Promise<void> {
    if (this.controller.signal.aborted) {
      return
    }

    if (this.pending) {
      return await this.pending
    }

    this.pending = this.run().finally(() => {
      this.pending = undefined
    })

    await this.pending
  }

  private async run(): Promise<void> {
    try {
      for (const runtime of await this.database.backend.containerRuntime.findMany({
        select: { id: true },
      })) {
        try {
          await this.coordinator.reconcile(runtime.id, this.controller.signal)
        } catch (error) {
          if (!this.controller.signal.aborted) {
            this.logger.error({ error, runtimeId: runtime.id }, "runtime reconciliation failed")
          }
        }
      }
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.logger.error({ error }, "runtime reconciliation failed")
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    clearInterval(this.timer)
    this.controller.abort()
    await this.pending
  }
}
