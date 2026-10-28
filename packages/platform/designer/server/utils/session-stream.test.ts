import { afterEach, expect, test, vi } from "vitest"
import { protectSessionStream } from "./session-stream"

afterEach(() => vi.useRealTimers())

test("terminates an idle subscription after session revocation", async () => {
  vi.useFakeTimers()
  const cleanup = vi.fn().mockResolvedValue({ done: true })

  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: cleanup }),
  }

  const validate = vi.fn().mockRejectedValue(new Error("Revoked"))
  const stream = protectSessionStream(source, validate)
  const failed = expect(stream.next()).rejects.toThrow("Revoked")
  await vi.advanceTimersByTimeAsync(5000)
  await failed
  expect(cleanup).toHaveBeenCalledOnce()
})

test("checks authorization before delivering a buffered event", async () => {
  async function* source() {
    yield "sensitive"
  }

  const stream = protectSessionStream(source(), async () => {
    throw new Error("Expired")
  })

  await expect(stream.next()).rejects.toThrow("Expired")
})
