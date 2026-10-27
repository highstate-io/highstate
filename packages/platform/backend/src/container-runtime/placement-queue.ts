/** Serializes native declarations within an operation's DNS view. */
export class RuntimePlacementQueue {
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly counts = new Map<string, number>()

  async run<T>(key: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const count = this.counts.get(key) ?? 0
    if (count >= 32) throw new Error("Runtime placement queue is full")
    this.counts.set(key, count + 1)
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted()
        return await operation()
      })
    this.tails.set(key, next)
    void next
      .finally(() => {
        const remaining = (this.counts.get(key) ?? 1) - 1
        if (remaining) this.counts.set(key, remaining)
        else this.counts.delete(key)
        if (this.tails.get(key) === next) this.tails.delete(key)
      })
      .catch(() => {})
    return await next
  }
}
