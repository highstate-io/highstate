import { describe, expect, test } from "vitest"
import { getCanonicalDesignerUrl, isDesignerOrigin } from "./designer-host"

describe("getCanonicalDesignerUrl", () => {
  test("redirects localhost while preserving port, path, and query", () => {
    expect(getCanonicalDesignerUrl(new URL("http://localhost:3000/project?tab=panel"))).toBe(
      "http://highstate.localhost:3000/project?tab=panel",
    )
  })

  test("redirects direct loopback access", () => {
    expect(getCanonicalDesignerUrl(new URL("http://127.0.0.1:7283/"))).toBe(
      "http://highstate.localhost:7283/",
    )
  })

  test("allows loopback access when canonical redirects are disabled", () => {
    expect(getCanonicalDesignerUrl(new URL("http://localhost:7283/"), true)).toBeUndefined()
  })

  test("preserves canonical and panel hosts", () => {
    expect(getCanonicalDesignerUrl(new URL("http://highstate.localhost:3000/"))).toBeUndefined()
    expect(
      getCanonicalDesignerUrl(new URL("http://panel.panels.highstate.localhost:3000/")),
    ).toBeUndefined()
  })
})

describe("isDesignerOrigin", () => {
  test("allows the canonical Designer origin", () => {
    expect(
      isDesignerOrigin(
        "http://highstate.localhost:7283",
        "ws://highstate.localhost:7283/api/events",
      ),
    ).toBe(true)
  })

  test("allows cross-port loopback origins when canonical redirects are disabled", () => {
    expect(isDesignerOrigin("http://localhost:3000", "ws://localhost:7283/api/events", true)).toBe(
      true,
    )
    expect(isDesignerOrigin("http://127.0.0.1:3000", "ws://127.0.0.1:7283/api/events", true)).toBe(
      true,
    )
  })

  test("rejects loopback origins when canonical redirects are enabled", () => {
    expect(isDesignerOrigin("http://localhost:7283", "ws://localhost:7283/api/events")).toBe(false)
  })

  test("rejects unrelated origins, protocols, and ports", () => {
    expect(
      isDesignerOrigin("http://example.com:7283", "ws://localhost:7283/api/events", true),
    ).toBe(false)
    expect(isDesignerOrigin("https://localhost:7283", "ws://localhost:7283/api/events", true)).toBe(
      false,
    )
    expect(isDesignerOrigin("http://localhost:3000", "ws://127.0.0.1:7283/api/events", true)).toBe(
      false,
    )
    expect(
      isDesignerOrigin(
        "http://highstate.localhost:3000",
        "ws://highstate.localhost:7283/api/events",
      ),
    ).toBe(false)
  })
})
