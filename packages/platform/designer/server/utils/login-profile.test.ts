import { describe, expect, test } from "vitest"
import { loginProviderConfigSchema } from "@highstate/contract"
import { mapLoginProfile, readLoginField } from "./login-profile"

const provider = loginProviderConfigSchema.parse({
  id: "example",
  title: "Example",
  clientId: "client",
  clientAuthMethod: "none",
  authorizationEndpoint: "https://example.com/authorize",
  tokenEndpoint: "https://example.com/token",
  identity: {
    protocol: "oauth2",
    authority: "example",
    userInfoUrl: "https://example.com/me",
    mapping: { subject: "user.id", name: "user.name", groups: "groups" },
  },
})

describe("login profile mapping", () => {
  test("normalizes numeric subjects without using mutable display fields", () => {
    const first = mapLoginProfile(provider, {
      user: { id: 42, name: "Before" },
      groups: ["operators"],
    })
    const second = mapLoginProfile(provider, { user: { id: "42", name: "After" }, groups: [] })
    expect(first.id).toBe(second.id)
    expect(first.groups).toHaveLength(1)
    expect(first.id).not.toBe(
      mapLoginProfile(
        {
          ...provider,
          identity: {
            ...provider.identity,
            protocol: "oauth2",
            authority: "other",
            userInfoUrl: "https://example.com/me",
            mapping: { subject: "user.id" },
          },
        },
        { user: { id: 42 } },
      ).id,
    )
  })

  test.each([
    undefined,
    null,
    {},
    [],
    true,
    Infinity,
    "",
  ])("rejects invalid subjects: %s", subject => {
    expect(() => mapLoginProfile(provider, { user: { id: subject }, groups: [] })).toThrow()
  })

  test("rejects prototype traversal and inherited identity fields", () => {
    expect(() => readLoginField({}, "constructor.prototype.id")).toThrow()
    expect(() => mapLoginProfile(provider, { user: Object.create({ id: "inherited" }) })).toThrow()
  })

  test("rejects malformed group claims rather than inventing memberships", () => {
    expect(() =>
      mapLoginProfile(provider, { user: { id: 1 }, groups: [{ name: "admins" }] }),
    ).toThrow()
  })
})
