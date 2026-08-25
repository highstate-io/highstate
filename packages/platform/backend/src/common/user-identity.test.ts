import { describe, expect, test } from "vitest"
import { getLocalUserId, getOidcUserGroupId, getOidcUserId } from "./user-identity"

describe("global user identities", () => {
  test("generates stable distinct user IDs", () => {
    expect(getLocalUserId("alice")).toBe(getLocalUserId("alice"))
    expect(getLocalUserId("alice")).not.toBe(getLocalUserId("bob"))
    expect(getOidcUserId("https://issuer.example", "alice")).not.toBe(getLocalUserId("alice"))
  })

  test("generates stable group IDs in a separate namespace", () => {
    expect(getOidcUserGroupId("https://issuer.example", "admins")).toBe(
      getOidcUserGroupId("https://issuer.example", "admins"),
    )
    expect(getOidcUserGroupId("https://issuer.example", "admins")).not.toBe(
      getOidcUserId("https://issuer.example", "admins"),
    )
  })
})
