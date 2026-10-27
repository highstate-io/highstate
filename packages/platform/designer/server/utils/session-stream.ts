/** Checks durable credentials during idle streams as well as before each emitted payload. */
export async function* protectSessionStream<T>(
  source: AsyncIterable<T>,
  validate: () => Promise<unknown>,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  let rejectValidation: (error: unknown) => void = () => {}
  const invalid = new Promise<never>((_, reject) => {
    rejectValidation = reject
  })
  const timer = setInterval(() => {
    void validate().catch(rejectValidation)
  }, 5000)
  timer.unref?.()
  try {
    while (true) {
      const item = await Promise.race([iterator.next(), invalid])
      if (item.done) return
      await validate()
      yield item.value
    }
  } finally {
    clearInterval(timer)
    void iterator.return?.()
  }
}
