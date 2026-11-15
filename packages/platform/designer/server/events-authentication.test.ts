import { afterEach, expect, test, vi } from "vitest"
import { opaqueToken } from "./utils/hosted-session"

const { createHandler, services } = vi.hoisted(() => ({
  createHandler: vi.fn(),
  services: { logger: { info: vi.fn(), error: vi.fn() } },
}))
vi.mock("@highstate/backend", async importOriginal => ({
  ...(await importOriginal<typeof import("@highstate/backend")>()),
  getSharedServices: async () => services,
}))
vi.mock("trpc-bun-adapter", () => ({ createBunServeHandler: createHandler }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test("captures the session before Bun releases WebSocket upgrade headers", async () => {
  vi.stubEnv("HIGHSTATE_AUTH_MODE", "hosted")
  vi.stubGlobal("defineNitroPlugin", (plugin: unknown) => plugin)
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { eventsPort: 3002 } }))
  const serve = vi
    .spyOn(Bun, "serve")
    .mockReturnValue({ stop: vi.fn() } as unknown as ReturnType<typeof Bun.serve>)
  createHandler.mockReturnValue({ fetch: vi.fn(), websocket: {} })
  const { default: plugin } = await import("./plugins/events")
  await (plugin as unknown as (nitro: unknown) => Promise<void>)({ hooks: { hookOnce: vi.fn() } })
  const token = opaqueToken()

  const request = new Request("https://designer.example/api/events", {
    headers: { cookie: `__Host-highstate-session=${token}` },
  })

  const options = serve.mock.calls[0]![0] as {
    fetch: (request: Request, server: unknown) => unknown
  }
  options.fetch(request, {})
  request.headers.delete("cookie")
  const context = await createHandler.mock.calls[0]![0].createContext({ req: request })
  expect(context.designerSessionToken).toBe(token)
})
