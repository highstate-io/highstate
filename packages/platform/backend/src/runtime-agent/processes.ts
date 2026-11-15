import { type ChildProcess, spawn } from "node:child_process"

/**
 * Every action is a new session/process group; force cancellation never targets its sibling actions.
 */
export class ActionProcesses {
  private readonly processes = new Map<string, ChildProcess>()

  start(
    actionId: string,
    module: string,
    payload: unknown,
    event: (message: unknown) => Promise<void>,
    output: (data: Buffer, stderr: boolean) => Promise<void>,
  ): Promise<void> {
    if (this.processes.has(actionId)) {
      throw new Error("Duplicate active runtime action")
    }

    const child = spawn(process.execPath, [module], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...process.env, HIGHSTATE_AGENT_CHILD: "true" },
    })

    this.processes.set(actionId, child)
    child.send(payload as import("node:child_process").Serializable)
    let pending = Promise.resolve()

    const enqueue = (operation: () => Promise<void>) => {
      child.stdout?.pause()
      child.stderr?.pause()

      pending = pending.then(operation).finally(() => {
        child.stdout?.resume()
        child.stderr?.resume()
      })

      void pending.catch(() => this.cancel(actionId, true))
    }

    child.stdout?.on("data", data => enqueue(() => output(data, false)))
    child.stderr?.on("data", data => enqueue(() => output(data, true)))
    child.on("message", message => enqueue(() => event(message)))
    return new Promise((resolve, reject) => {
      child.once("error", reject)

      child.once("close", (code, signal) => {
        this.processes.delete(actionId)

        void pending.then(
          () =>
            code === 0 ? resolve() : reject(new Error(`Action process exited (${code ?? signal})`)),
          reject,
        )
      })
    })
  }

  respond(actionId: string, message: unknown): void {
    this.processes.get(actionId)?.send(message as import("node:child_process").Serializable)
  }

  cancel(actionId: string, force: boolean): boolean {
    const child = this.processes.get(actionId)
    if (!child?.pid) {
      return false
    }

    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGINT")
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return false
      }

      throw error
    }
  }

  stop(): void {
    for (const id of this.processes.keys()) {
      this.cancel(id, true)
    }
  }
}
