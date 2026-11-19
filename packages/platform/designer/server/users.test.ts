import type { Services } from "@highstate/backend"
import { afterEach, expect, test, vi } from "vitest"
import { backendUserSettingsRouter } from "./routers/settings/users"
import { opaqueToken } from "./utils/hosted-session"

afterEach(() => vi.unstubAllEnvs())

test("user-directory subscriptions re-resolve grants while they are open", async () => {
  vi.stubEnv("HIGHSTATE_AUTH_MODE", "hosted")
  vi.stubEnv("HIGHSTATE_PUBLIC_URL", "https://designer.example")

  vi.stubEnv(
    "HIGHSTATE_AUTH_PROVIDERS",
    JSON.stringify([
      {
        id: "test",
        title: "Test",
        clientId: "test",
        clientAuthMethod: "none",
        identity: { protocol: "oidc", issuer: "https://issuer.example" },
      },
    ]),
  )

  const roles = vi
    .fn()
    .mockResolvedValue([
      { rules: [{ permissions: ["user.get", "role.list", "role-binding.list"] }] },
    ])

  const revision = vi
    .fn()
    .mockImplementation(async context =>
      context.permissions.has("role.update") ? "writable" : "read-only",
    )

  const services = {
    designerSessionToken: opaqueToken(),
    database: {
      backend: {
        designerSession: {
          findUnique: vi.fn().mockResolvedValue({
            userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
            identity: {
              id: "aaaaaaaaaaaaaaaaaaaaaaaa",
              type: "oidc",
              meta: { title: "User" },
              groups: [],
            },
            expiresAt: new Date(Date.now() + 60000),
            revokedAt: null,
          }),
        },
        backendRole: { findMany: roles },
      },
    },
    userSettingsService: { getRevision: revision },
  } as unknown as Services & { designerSessionToken: string }

  const stream = await backendUserSettingsRouter
    .createCaller(services)
    .watch({ userId: "bbbbbbbbbbbbbbbbbbbbbbbb", bindings: true })

  const iterator = stream[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toBe("read-only")

  roles.mockResolvedValue([
    { rules: [{ permissions: ["user.get", "role.list", "role-binding.list", "role.update"] }] },
  ])

  expect((await iterator.next()).value).toBe("writable")
  await iterator.return?.(undefined)
})
