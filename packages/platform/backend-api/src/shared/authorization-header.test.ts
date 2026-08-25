import { Code } from "@connectrpc/connect"
import { describe, expect, it } from "vitest"
import { parseBearerToken } from "./authorization-header"

describe("parseBearerToken", () => {
  it("accepts a case-insensitive Bearer scheme without normalizing the token", () => {
    expect(parseBearerToken("Bearer hcp_key_secret")).toBe("hcp_key_secret")
    expect(parseBearerToken("BEARER hcb_KEY_secret")).toBe("hcb_KEY_secret")
  })

  it.each([
    null,
    "",
    "hcp_key_secret",
    "Basic hcp_key_secret",
    "Bearer",
    "Bearer ",
    "Bearer  token",
    "Bearer token ",
    " Bearer token",
    "Bearer token value",
    "Bearer\ttoken",
    "Bearer\ntoken",
    "Bearer token\n",
    "Bearer token\u0000",
    "Bearer token\u00a0value",
    `Bearer ${"a".repeat(10_000)} value`,
  ])("rejects malformed authorization header %s", authorization => {
    expect(() => parseBearerToken(authorization)).toThrowError(
      expect.objectContaining({
        code: Code.Unauthenticated,
        rawMessage: "Invalid authorization header",
      }),
    )
  })
})
