/** Couples adapter-owned build requests to native workload cleanup. */
export class RuntimeBuildTasks {
  private readonly tasks = new Map<
    string,
    { controller: AbortController; done: Promise<unknown> }
  >()

  async run<T>(
    workloadId: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.tasks.has(workloadId)) throw new Error("Workload image build is already active")
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const done = Promise.resolve().then(() => {
      combined.throwIfAborted()
      return operation(combined)
    })
    this.tasks.set(workloadId, { controller, done })
    try {
      return await done
    } finally {
      this.tasks.delete(workloadId)
    }
  }

  async cancel(workloadId: string): Promise<void> {
    const task = this.tasks.get(workloadId)
    if (!task) return
    task.controller.abort(new Error("Runtime workload cleanup requested"))
    await task.done.catch(() => {})
  }
}
