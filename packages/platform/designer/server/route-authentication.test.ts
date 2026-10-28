import type { Services } from "@highstate/backend"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { opaqueToken, sessionCookie } from "./utils/hosted-session"
import { createPanelLaunchTicket, exchangePanelLaunchTicket } from "./utils/panel-session"

const { getSharedServices } = vi.hoisted(() => ({ getSharedServices: vi.fn() }))
vi.mock("@highstate/backend", async importOriginal => ({
  ...(await importOriginal<typeof import("@highstate/backend")>()),
  getSharedServices,
}))

type TestEvent = {
  url: URL
  path: string
  method: string
  headers: Headers
  context: Record<string, unknown>
  params?: Record<string, string>
}

function event(url: string, headers: Record<string, string> = {}, method = "GET"): TestEvent {
  const parsed = new URL(url)
  return {
    url: parsed,
    path: parsed.pathname,
    method,
    headers: new Headers({ host: parsed.host, ...headers }),
    context: {},
  }
}

beforeEach(() => {
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

  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
  vi.stubGlobal("getRequestURL", (event: TestEvent) => event.url)

  vi.stubGlobal(
    "getHeader",
    (event: TestEvent, name: string) => event.headers.get(name) ?? undefined,
  )

  vi.stubGlobal("getHeaders", (event: TestEvent) => Object.fromEntries(event.headers))

  vi.stubGlobal("getCookie", (event: TestEvent, name: string) =>
    event.headers
      .get("cookie")
      ?.split(";")
      .map(value => value.trim())
      .find(value => value.startsWith(`${name}=`))
      ?.slice(name.length + 1),
  )

  vi.stubGlobal("setCookie", vi.fn())
  vi.stubGlobal("getRouterParam", (event: TestEvent, name: string) => event.params?.[name])
  vi.stubGlobal("getQuery", (event: TestEvent) => Object.fromEntries(event.url.searchParams))
  vi.stubGlobal("setHeader", vi.fn())
  vi.stubGlobal("setResponseStatus", vi.fn())

  vi.stubGlobal("createError", (details: object) =>
    Object.assign(new Error("Request rejected"), details),
  )

  vi.stubGlobal("sendRedirect", (_event: TestEvent, location: string) => location)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function servicesWithPermissions(permissions: string[]) {
  const project = {
    user: { upsert: vi.fn() },
    role: {
      findMany: vi.fn().mockResolvedValue(permissions.length ? [{ rules: [{ permissions }] }] : []),
    },
    artifact: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "private-artifact", hash: "hash", meta: {}, size: 10 }),
    },
    $transaction: vi.fn(),
  }

  project.$transaction.mockImplementation(async callback => await callback(project))
  const retrieve = vi.fn()

  const services = {
    database: {
      backend: {
        designerSession: {
          findUnique: vi.fn().mockResolvedValue({
            userId: "human",
            identity: { id: "human", type: "oidc", meta: { title: "Human" }, groups: [] },
            expiresAt: new Date(Date.now() + 60000),
            revokedAt: null,
          }),
        },
      },
      forProject: vi.fn().mockResolvedValue(project),
    },
    artifactBackend: { retrieve },
  }

  getSharedServices.mockResolvedValue(services as unknown as Services)
  return { services, retrieve, project }
}

test("HTTP middleware rejects missing sessions and cross-origin mutations", async () => {
  const { services } = servicesWithPermissions([])
  const { default: guard } = await import("./middleware/00.authentication")
  const url = "https://designer.example/api/private"
  await expect(guard(event(url) as never)).rejects.toMatchObject({ statusCode: 401 })
  const cookie = `${sessionCookie}=${opaqueToken()}`
  const authenticated = event(url, { cookie })
  await guard(authenticated as never)
  expect(authenticated.context.designerIdentity).toMatchObject({ id: "human" })

  for (const origin of [
    undefined,
    "https://other.panels.designer.example",
    "https://attacker.example",
  ]) {
    await expect(
      guard(event(url, { cookie, ...(origin ? { origin } : {}) }, "POST") as never),
    ).rejects.toMatchObject({ statusCode: 403 })
  }

  services.database.backend.designerSession.findUnique.mockResolvedValue(null)
  await expect(guard(event(url, { cookie }) as never)).rejects.toMatchObject({ statusCode: 401 })
})

test("artifact IDOR checks permissions before accessing content storage", async () => {
  const { retrieve } = servicesWithPermissions([])
  const { default: handler } = await import("./api/projects/[projectId]/artifacts/[hash]")

  const request = event("https://designer.example/api/projects/project/artifacts/hash", {
    cookie: `${sessionCookie}=${opaqueToken()}`,
  })

  request.params = { projectId: "project", hash: "hash" }
  await expect(handler(request as never)).rejects.toMatchObject({ statusCode: 403 })
  expect(retrieve).not.toHaveBeenCalled()
})

test("artifact downloads prevent caching and stop delivering chunks after role revocation", async () => {
  const { retrieve, project } = servicesWithPermissions(["artifact.get"])

  retrieve.mockImplementation(async function* () {
    yield Buffer.from("first")
    project.role.findMany.mockResolvedValue([])
    yield Buffer.from("private")
  })

  const { default: handler } = await import("./api/projects/[projectId]/artifacts/[hash]")
  const res = { flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() }

  const request = {
    ...event("https://designer.example/api/projects/project/artifacts/hash", {
      cookie: `${sessionCookie}=${opaqueToken()}`,
    }),
    params: { projectId: "project", hash: "hash" },
    node: { res },
  }

  await expect(handler(request as never)).rejects.toMatchObject({ statusCode: 403 })
  expect(res.write.mock.calls.map(([chunk]) => String(chunk))).toEqual(["first"])
  expect(setHeader).toHaveBeenCalledWith(request, "Cache-Control", "private, no-store")
})

test("panel subdomain handoff uses a one-use ticket and its own scoped secure cookie", async () => {
  servicesWithPermissions(["panel.get"])
  const token = opaqueToken()
  const ticket = createPanelLaunchTicket("project", "panel123", "worker", token)
  const { default: handler } = await import("./api/panels/launch")

  const launch = () =>
    event(`https://panel123.panels.designer.example/api/panels/launch?ticket=${ticket}`)

  expect(await handler(launch() as never)).toBe("/")

  expect(setCookie).toHaveBeenCalledWith(
    expect.anything(),
    "highstate-panel-session",
    expect.any(String),
    {
      domain: "panel123.panels.designer.example",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60,
    },
  )

  expect(vi.mocked(setCookie).mock.calls[0]?.[2]).not.toBe(token)
  await expect(handler(launch() as never)).rejects.toMatchObject({ statusCode: 401 })
})

test("panel WebSockets require both the capability cookie and an owning-panel origin", async () => {
  servicesWithPermissions(["panel.get"])
  vi.stubGlobal("defineWebSocketHandler", (handler: unknown) => handler)
  const ticket = createPanelLaunchTicket("project", "panelws", "worker", opaqueToken())
  const session = exchangePanelLaunchTicket(ticket, "panelws")!
  const { default: handler } = await import("./routes/[...panel]")

  const upgrade = (
    handler as unknown as {
      upgrade: (request: { url: string; headers: Headers }) => Promise<Response | undefined>
    }
  ).upgrade

  const url = "https://nested.panelws.panels.designer.example/socket"

  const request = (origin: string, cookie?: string) => ({
    url,
    headers: new Headers({
      host: "nested.panelws.panels.designer.example",
      origin,
      ...(cookie ? { cookie } : {}),
    }),
  })

  const cookie = `highstate-panel-session=${session}`

  expect(
    await upgrade(request("https://nested.panelws.panels.designer.example", cookie)),
  ).toBeUndefined()

  expect((await upgrade(request("https://other.panels.designer.example", cookie)))?.status).toBe(
    401,
  )

  expect((await upgrade(request("https://panelws.panels.designer.example")))?.status).toBe(401)
})
