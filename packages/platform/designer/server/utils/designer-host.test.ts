import { describe, expect, test } from "vitest"
import { getCanonicalDesignerUrl } from "./designer-host"

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
