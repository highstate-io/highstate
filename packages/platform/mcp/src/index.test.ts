import { afterEach, describe, expect, it, vi } from "vitest"
import { createHighstateMcpHandler, createPlanStore } from "./index"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createHighstateMcpHandler", () => {
  it("rejects requests without Highstate credentials", async () => {
    const handler = createHighstateMcpHandler({ apiUrl: "http://localhost:7282" })
    const response = await handler(new Request("http://localhost/mcp", { method: "POST" }))

    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain("apiToken")
  })

  it.each([
    "Basic token",
    "Bearer",
    "Bearer ",
    "Bearer token value",
    "bearer\ttoken",
  ])("rejects invalid authorization header %s instead of using the fallback", async authorization => {
    const fetch = vi.spyOn(globalThis, "fetch")
    const handler = createHighstateMcpHandler({
      apiUrl: "http://localhost:7282",
      apiToken: "fallback",
    })

    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization },
      }),
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("uses the configured token when the header is absent", async () => {
    const handler = createHighstateMcpHandler({
      apiUrl: "http://localhost:7282",
      apiToken: "fallback",
    })
    const response = await handler(new Request("http://localhost/mcp", { method: "POST" }))

    expect(response.status).not.toBe(401)
  })

  it("does not create token state for invalid requests", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
    const handler = createHighstateMcpHandler({
      apiUrl: "http://localhost:7282",
      apiToken: "fallback",
    })

    await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { authorization: "Bearer invalid value" },
      }),
    )

    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("createPlanStore", () => {
  it("expires token state and does not share plans between tokens", () => {
    let currentTime = 0
    const store = createPlanStore(() => currentTime)
    const plans = store.getPlans("token-a")
    plans.set("plan", {} as never)

    expect(store.getPlans("token-b").has("plan")).toBe(false)
    currentTime = 15 * 60 * 1000
    expect(store.getPlans("token-a").has("plan")).toBe(false)
  })
})
