import type { Services } from "@highstate/backend"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  authenticateHostedSession,
  createHostedSession,
  hashToken,
  monitorHostedSession,
  opaqueToken,
} from "./hosted-session"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("durable hosted sessions", () => {
  const identity = { id: "human", type: "oidc", meta: { title: "Human" }, groups: [] }
  test.each([
    null,
    { identity, userId: "human", expiresAt: new Date(0), revokedAt: null },
    { identity, userId: "human", expiresAt: new Date(Date.now() + 100000), revokedAt: new Date() },
    {
      identity: { ...identity, type: "local" },
      userId: "human",
      expiresAt: new Date(Date.now() + 100000),
    },
  ])("rejects absent, expired, revoked and local sessions", async session => {
    const services = {
      database: {
        backend: { designerSession: { findUnique: vi.fn().mockResolvedValue(session) } },
      },
    } as unknown as Services
    await expect(authenticateHostedSession(services, opaqueToken())).rejects.toThrow()
  })

  test("looks up only the token digest and closes idle connections on revocation", async () => {
    vi.useFakeTimers()
    const token = opaqueToken()
    const findUnique = vi.fn().mockResolvedValue({
      identity,
      userId: "human",
      expiresAt: new Date(Date.now() + 100000),
      revokedAt: null,
    })
    const services = {
      database: { backend: { designerSession: { findUnique } } },
    } as unknown as Services
    await expect(authenticateHostedSession(services, token)).resolves.toEqual(identity)
    expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken(token) } })
    const close = vi.fn()
    const timer = monitorHostedSession(services, token, close)
    findUnique.mockResolvedValue({
      identity,
      userId: "human",
      expiresAt: new Date(Date.now() + 100000),
      revokedAt: new Date(),
    })
    await vi.advanceTimersByTimeAsync(5000)
    expect(close).toHaveBeenCalledOnce()
    clearInterval(timer)
  })

  test("refreshes older browser sessions when a new login removes group membership", async () => {
    vi.stubEnv("HIGHSTATE_AUTH_MODE", "hosted")
    vi.stubEnv("HIGHSTATE_PUBLIC_URL", "https://designer.example")
    vi.stubEnv(
      "HIGHSTATE_AUTH_PROVIDERS",
      JSON.stringify([
        {
          id: "test",
          title: "Test",
          clientId: "client",
          clientAuthMethod: "none",
          identity: { protocol: "oidc", issuer: "https://issuer.example" },
        },
      ]),
    )
    const previous = {
      identity: { ...identity, groups: [{ id: "admins", title: "Admins" }] },
      userId: identity.id,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
    }
    const updateMany = vi.fn(async ({ data }) => {
      previous.identity = data.identity
    })
    const create = vi.fn()
    const services = {
      database: {
        backend: {
          user: { upsert: vi.fn() },
          designerSession: { updateMany, create, findUnique: vi.fn(async () => previous) },
        },
      },
    } as unknown as Services
    await createHostedSession(services, { ...identity, type: "oidc" })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: identity.id, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { identity },
    })
    expect((await authenticateHostedSession(services, opaqueToken())).groups).toEqual([])
    expect(create).toHaveBeenCalledOnce()
  })

  test("rejects creating hosted sessions for local identities before writing data", async () => {
    await expect(
      createHostedSession({} as Services, {
        ...identity,
        type: "local",
      }),
    ).rejects.toThrow("Invalid hosted identity")
  })
})
