import { EventEmitter } from "node:events"
import { type Stats, statSync } from "node:fs"
import { stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import Watcher from "watcher"

/**
 * Watches workspace contents without opening ancestor directories or unrelated siblings.
 */
export class WorkspaceWatcher extends EventEmitter<{
  all: [event: string, path: string]
  error: [error: Error]
  ready: []
}> {
  private readonly root: string
  private watcher?: Watcher
  private closed = false
  private identity?: { ino: number; dev: number }
  private readonly rootPoller: ReturnType<typeof setInterval>
  private polling = false

  constructor(
    workspacePath: string,
    private readonly options: { pollingInterval?: number; debounce?: number } = {},
  ) {
    super()
    this.root = resolve(workspacePath)
    const stats = statSync(this.root, { throwIfNoEntry: false })
    this.identity = stats ? { ino: stats.ino, dev: stats.dev } : undefined
    this.start(true)
    this.rootPoller = setInterval(() => void this.pollRoot(), options.pollingInterval ?? 3000)
  }

  private async pollRoot(): Promise<void> {
    if (this.closed || this.polling) {
      return
    }

    this.polling = true

    try {
      this.rootChanged(await stat(this.root))
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.rootChanged(undefined)
      } else if (!this.closed) {
        this.emit(
          "error",
          error instanceof Error
            ? error
            : new Error("Failed to inspect workspace root", { cause: error }),
        )
      }
    } finally {
      this.polling = false
    }
  }

  private rootChanged(current: Stats | undefined): void {
    if (this.closed) {
      return
    }

    if (!current || current.nlink === 0) {
      if (!this.identity) {
        return
      }

      this.identity = undefined
      this.watcher?.close()
      this.watcher = undefined
      this.emit("all", "unlinkDir", this.root)
    } else if (current.ino !== this.identity?.ino || current.dev !== this.identity?.dev) {
      this.identity = { ino: current.ino, dev: current.dev }
      this.start(false)
    }
  }

  private start(ignoreInitial: boolean): void {
    this.watcher?.close()

    const watcher = new Watcher(this.root, {
      recursive: true,
      ignoreInitial,
      debounce: this.options.debounce,
      ignore: target => {
        const path = relative(this.root, resolve(target))
        // reject ancestors too: watcher otherwise installs a native parent-directory watch
        return (
          path === ".." ||
          path.startsWith(`..${sep}`) ||
          isAbsolute(path) ||
          /(^|[/\\])(\.git|node_modules|dist|\.highstate|\.nx)([/\\]|$)/.test(path)
        )
      },
    })

    this.watcher = watcher

    watcher.on("all", (event: string, path: string) => {
      if (!this.closed && this.watcher === watcher) {
        this.emit("all", event, path)
      }
    })

    watcher.on("error", (error: Error) => {
      if (!this.closed && this.watcher === watcher) {
        this.emit("error", error)
      }
    })

    watcher.on("ready", () => {
      if (!this.closed && this.watcher === watcher) {
        this.emit("ready")
      }
    })
  }

  close(): void {
    this.closed = true
    clearInterval(this.rootPoller)
    this.watcher?.close()
    this.watcher = undefined
  }
}
