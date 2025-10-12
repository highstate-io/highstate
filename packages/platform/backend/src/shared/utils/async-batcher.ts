export type AsyncBatcherOptions = {
  waitMs?: number
  maxWaitTimeMs?: number
}

export type AsyncBatcher<T> = {
  /**
   * Add an item to the batch.
   */
  call(item: T): void

  /**
   * Immediately flush the pending batch (if any).
   */
  flush(): Promise<void>
}

export function createAsyncBatcher<T>(
  fn: (items: T[]) => Promise<void> | void,
  { waitMs = 100, maxWaitTimeMs = 1000 }: AsyncBatcherOptions = {},
): AsyncBatcher<T> {
  let batch: T[] = []
  let activeTimeout: NodeJS.Timeout | null = null
  let maxWaitTimeout: NodeJS.Timeout | null = null
  let firstCallTimestamp: number | null = null

  async function processBatch() {
    if (batch.length === 0) return

    const currentBatch = batch
    batch = [] // Reset batch before async call

    await fn(currentBatch)

    // Clear max wait timer since batch has been processed
    if (maxWaitTimeout) {
      clearTimeout(maxWaitTimeout)
      maxWaitTimeout = null
    }
    firstCallTimestamp = null
  }

  function schedule() {
    if (activeTimeout) clearTimeout(activeTimeout)
    activeTimeout = setTimeout(() => {
      activeTimeout = null
      void processBatch()
    }, waitMs)

    // Ensure batch is executed within maxWaitTimeMs
    if (!firstCallTimestamp) {
      firstCallTimestamp = Date.now()
      maxWaitTimeout = setTimeout(() => {
        if (activeTimeout) clearTimeout(activeTimeout)
        activeTimeout = null
        void processBatch()
      }, maxWaitTimeMs)
    }
  }

  return {
    /**
     * Add an item to the batch.
     */
    call(item: T): void {
      batch.push(item)
      schedule()
    },

    /**
     * Immediately flush the pending batch (if any).
     */
    async flush(): Promise<void> {
      if (activeTimeout) {
        clearTimeout(activeTimeout)
        activeTimeout = null
      }
      if (maxWaitTimeout) {
        clearTimeout(maxWaitTimeout)
        maxWaitTimeout = null
      }
      await processBatch()
    },
  }
}
