import { afterEach, expect, test, vi } from "vitest"
import {
  getHostedAuthConfig,
  hostedAuthConfigSchema,
  isAllowedHostedUrl,
  isDevelopmentHttpEnabled,
} from "./auth-config"
import {
  getCookieOptions,
  getLoginCookieName,
  getSessionCookieName,
  sessionTokenFromHeaders,
} from "./hosted-session"

afterEach(() => vi.unstubAllEnvs())

test("development HTTP requires an explicit opt-in and rejects production", () => {
  vi.stubEnv("NODE_ENV", "development")
  expect(isAllowedHostedUrl("http://localhost:3000")).toBe(false)
  vi.stubEnv("HIGHSTATE_AUTH_DEVELOPMENT_HTTP", "true")
  expect(isDevelopmentHttpEnabled()).toBe(true)
  vi.stubEnv("NODE_ENV", "production")
  expect(() => isDevelopmentHttpEnabled()).toThrow("only available in development")
  vi.stubEnv("HIGHSTATE_AUTH_DEVELOPMENT_HTTP", "yes")
  expect(() => isDevelopmentHttpEnabled()).toThrow("Invalid")
})

test.each([
  ["http://localhost:3000", true],
  ["http://highstate.localhost:3000", true],
  ["http://127.0.0.1:3000", true],
  ["http://[::1]:3000", true],
  ["http://localhost.example", false],
  ["http://192.168.1.10", false],
  ["http://issuer.example", false],
  ["https://designer.example", false],
  ["ftp://localhost", false],
])("limits development HTTP origins and providers to loopback: %s", (url, allowed) => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("HIGHSTATE_AUTH_DEVELOPMENT_HTTP", "true")
  expect(isAllowedHostedUrl(url)).toBe(url.startsWith("https:") || allowed)

  expect(
    hostedAuthConfigSchema.safeParse({
      publicUrl: url,
      providers: [
        {
          id: "test",
          title: "Test",
          clientId: "client",
          clientAuthMethod: "none",
          identity: { protocol: "oidc", issuer: "http://localhost:4000" },
        },
      ],
    }).success,
  ).toBe(allowed)
})

test("isolates development cookies from secure hosted sessions", () => {
  const secureHeaders = new Headers({ cookie: "__Host-highstate-session=secure" })
  const developmentHeaders = new Headers({ cookie: "highstate-dev-session=development" })
  expect(getCookieOptions()).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" })
  expect(sessionTokenFromHeaders(developmentHeaders)).toBeUndefined()
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("HIGHSTATE_AUTH_DEVELOPMENT_HTTP", "true")
  expect(getCookieOptions()).toMatchObject({ secure: false, httpOnly: true, sameSite: "lax" })
  expect(getLoginCookieName()).toBe("highstate-dev-login")
  expect(getSessionCookieName()).toBe("highstate-dev-session")
  expect(sessionTokenFromHeaders(secureHeaders)).toBeUndefined()
  expect(sessionTokenFromHeaders(developmentHeaders)).toBe("development")
})

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
