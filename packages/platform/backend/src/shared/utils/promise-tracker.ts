export class PromiseTracker {
  private readonly trackedPromises = new Set<Promise<unknown>>()

  /**
   * Tracks a promise to ensure its rejection is handled inside the tracker's scope.
   */
  track<T>(promise: Promise<T>): void {
    const wrapped = promise.finally(() => this.trackedPromises.delete(promise))

    this.trackedPromises.add(wrapped)
  }

  /**
   * Waits for all tracked promises to resolve or reject.
   */
  async waitForAll(): Promise<void> {
    if (this.trackedPromises.size === 0) {
      return
    }

    const toTrack = Array.from(this.trackedPromises)
    this.trackedPromises.clear()

    await waitAll(toTrack)
  }
}

/**
 * Waits for all promises to resolve or reject.
 *
 * Will throw a `AggregateError` if any of the promises are rejected.
 *
 * Unlike `Promise.all`, this function does not short-circuit on the first rejection,
 * allowing all promises to be awaited before handling errors.
 *
 * @param promises The iterable of promises to wait for.
 */
export async function waitAll(promises: Iterable<Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(promises)
  const rejected = results.filter(p => p.status === "rejected")

  if (!rejected.length) {
    return
  }

  throw new AggregateError(
    rejected.map(p => p.reason as Error),
    "Some promises were rejected",
  )
}
