import { afterEach, expect, it, vi } from "vitest"
import configureBunHttpTimeout from "./plugins/00.bun-http-timeout"

afterEach(() => vi.unstubAllEnvs())

it("allows slow library requests to finish under the production Bun server", () => {
  vi.stubEnv("NITRO_BUN_IDLE_TIMEOUT", undefined)
  configureBunHttpTimeout()
  expect(process.env.NITRO_BUN_IDLE_TIMEOUT).toBe("180")
})

it("preserves an explicitly configured idle timeout", () => {
  vi.stubEnv("NITRO_BUN_IDLE_TIMEOUT", "240")
  configureBunHttpTimeout()
  expect(process.env.NITRO_BUN_IDLE_TIMEOUT).toBe("240")
})
