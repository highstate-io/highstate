import { afterEach, expect, test, vi } from "vitest"
import { withTimeout } from "./wait"

afterEach(() => vi.useRealTimers())

test("bounds stalled scenario operations", async () => {
  vi.useFakeTimers()
  const result = withTimeout("panel transition", new Promise<never>(() => {}), 100)
  const assertion = expect(result).rejects.toThrow("Timed out waiting for panel transition")
  await vi.advanceTimersByTimeAsync(100)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

test("clears the deadline when a scenario completes or rejects", async () => {
  vi.useFakeTimers()
  await expect(withTimeout("success", Promise.resolve("completed"), 100)).resolves.toBe("completed")

  await expect(
    withTimeout("failure", Promise.reject(new Error("Original failure")), 100),
  ).rejects.toThrow("Original failure")

  expect(vi.getTimerCount()).toBe(0)
})
