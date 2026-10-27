import { afterEach, expect, test, vi } from "vitest"
import { getHostedAuthConfig } from "./auth-config"

afterEach(() => vi.unstubAllEnvs())

test.each([
  { protocol: "oidc", issuer: "http://issuer.example" },
  { protocol: "oidc", issuer: "https://issuer.example/.well-known/openid-configuration" },
])("never caches rejected provider configuration: %j", identity => {
  vi.stubEnv("HIGHSTATE_AUTH_MODE", "hosted")
  vi.stubEnv("HIGHSTATE_PUBLIC_URL", "https://designer.example")
  vi.stubEnv(
    "HIGHSTATE_AUTH_PROVIDERS",
    JSON.stringify([
      { id: "test", title: "Test", clientId: "client", clientAuthMethod: "none", identity },
    ]),
  )
  expect(() => getHostedAuthConfig()).toThrow()
  expect(() => getHostedAuthConfig()).toThrow()
})
