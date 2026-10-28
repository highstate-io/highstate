/** Waits for an observable condition within one deadline, preserving the last observation. */
export async function waitFor<T>(
  description: string,
  observe: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await observe()
    if (ready(last)) return last
    await Bun.sleep(Math.min(100, Math.max(0, deadline - Date.now())))
  }
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(last, (_, value) => (typeof value === "bigint" ? String(value) : value))}`,
  )
}
