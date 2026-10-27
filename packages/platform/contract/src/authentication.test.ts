import { describe, expect, it } from "vitest"
import { loginFieldPathSchema, loginProviderConfigSchema } from "./authentication"

const oidc = {
  id: "company",
  title: "Company",
  clientId: "client",
  clientSecret: "secret",
  identity: { protocol: "oidc", issuer: "https://identity.example.com" },
}

describe("login provider configuration", () => {
  it("allows OIDC discovery and preserves configured claim paths", () => {
    const config = loginProviderConfigSchema.parse({
      ...oidc,
      identity: { ...oidc.identity, groups: "realm_access.roles" },
    })

    expect(config.identity).toEqual({ ...oidc.identity, groups: "realm_access.roles" })
    expect(config.clientAuthMethod).toBe("client_secret_basic")
  })

  it("requires explicit OAuth2 endpoints while retaining generic identity mappings", () => {
    const input = {
      ...oidc,
      identity: {
        protocol: "oauth2",
        authority: "https://identity.example.com",
        userInfoUrl: "https://identity.example.com/user",
        mapping: { subject: "account.id", groups: "memberships.0.roles" },
      },
    }

    expect(loginProviderConfigSchema.safeParse(input).success).toBe(false)
    expect(
      loginProviderConfigSchema.parse({
        ...input,
        authorizationEndpoint: "https://identity.example.com/authorize",
        tokenEndpoint: "https://identity.example.com/token",
      }).identity,
    ).toEqual(input.identity)
  })

  it("requires secrets only for authenticated clients", () => {
    expect(loginProviderConfigSchema.safeParse({ ...oidc, clientSecret: undefined }).success).toBe(
      false,
    )
    expect(
      loginProviderConfigSchema.safeParse({
        ...oidc,
        clientSecret: undefined,
        clientAuthMethod: "none",
      }).success,
    ).toBe(true)
  })

  it.each(["file:///etc/passwd", "javascript:alert(1)"])("rejects non-HTTP issuer %s", issuer => {
    expect(
      loginProviderConfigSchema.safeParse({
        ...oidc,
        identity: { protocol: "oidc", issuer },
      }).success,
    ).toBe(false)
  })
})

describe("login field paths", () => {
  it.each([
    "__proto__.id",
    "profile.constructor.name",
    "prototype.id",
    "user[id]",
    "id.toString()",
    "a..b",
  ])("rejects unsafe or executable path %s", path =>
    expect(loginFieldPathSchema.safeParse(path).success).toBe(false))

  it("supports nested properties and numeric array indices", () => {
    expect(loginFieldPathSchema.parse("profiles.0.user_id")).toBe("profiles.0.user_id")
  })
})
