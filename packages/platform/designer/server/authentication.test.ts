import type { Services } from "@highstate/backend"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { appRouter } from "./router"
import { opaqueToken } from "./utils/hosted-session"
import { getLocalUser } from "./authentication"
import { projectProcedure, router } from "./trpc"

vi.mock("@highstate/backend", async importOriginal => ({
  ...(await importOriginal<typeof import("@highstate/backend")>()),
  getSharedServices: vi.fn().mockResolvedValue({}),
}))

beforeEach(() => {
  vi.stubEnv("HIGHSTATE_AUTH_MODE", "hosted")
  vi.stubEnv("HIGHSTATE_PUBLIC_URL", "https://designer.example")
  vi.stubEnv(
    "HIGHSTATE_AUTH_PROVIDERS",
    JSON.stringify([
      {
        id: "example",
        title: "Example",
        clientId: "client",
        clientAuthMethod: "none",
        identity: { protocol: "oidc", issuer: "https://issuer.example" },
      },
    ]),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("hosted direct Designer access", () => {
  function authorizedServices(permissions: string[]) {
    const findMany = vi.fn().mockResolvedValue([{ rules: [{ permissions }] }])
    const project = {
      designerAuthInitialization: {
        findUnique: vi.fn().mockResolvedValue({ id: "hosted-admin-v1" }),
      },
      user: { upsert: vi.fn() },
      role: { findMany },
      terminalSession: { findUnique: vi.fn().mockResolvedValue(null) },
      operation: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    }
    project.$transaction.mockImplementation(async callback => await callback(project))
    const subscribe = vi.fn(async function* () {
      yield "first"
      yield "second"
    })
    const watchSession = vi.fn()
    const cancel = vi.fn()
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
      pubsubManager: { subscribe },
      terminalManager: { watchSession },
      operationManager: { cancel },
      designerSessionToken: opaqueToken(),
    }
    return { services, project, subscribe, watchSession, cancel }
  }

  test("denies cross-project active terminal and operation IDs before calling global managers", async () => {
    const { services, watchSession, cancel } = authorizedServices([
      "terminal.get",
      "operation.cancel",
    ])
    const caller = appRouter.createCaller(services as unknown as Services)
    await expect(
      caller.terminal.watchSession({ projectId: "allowed", sessionId: "other-project-session" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(
      caller.operation.cancel({ projectId: "allowed", operationId: "other-project-operation" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(watchSession).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  test("closes a project event subscription before emitting data after its role is revoked", async () => {
    const { services, project } = authorizedServices(["instance-state.list"])
    const caller = appRouter.createCaller(services as unknown as Services)
    const stream = await caller.state.watchInstanceStates({ projectId: "project" })
    const iterator = stream[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: "first" })
    project.role.findMany.mockResolvedValue([])
    await expect(iterator.next()).rejects.toThrow()
  })

  test("closes context-aware subscriptions when a resource grant is narrowed", async () => {
    const { services, project } = authorizedServices(["terminal.get"])
    const testRouter = router({
      watch: projectProcedure.subscription(async function* () {
        yield "first"
        yield "second"
      }),
    })
    const stream = await testRouter.createCaller(services as unknown as Services).watch({
      projectId: "x123456789012345678901234",
    })
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toBe("first")
    project.role.findMany.mockResolvedValue([
      {
        rules: [
          {
            permissions: ["terminal.get"],
            restrictions: [{ type: "resources", resourceIds: ["one-terminal"] }],
          },
        ],
      },
    ])
    await expect(iterator.next()).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  test.each([
    "https://designer.example",
    "https://attacker.example",
  ])("rejects unauthenticated terminal WebSocket upgrades from %s", async origin => {
    vi.stubGlobal("defineWebSocketHandler", (handler: unknown) => handler)
    const { default: handler } = await import("./api/projects/[projectId]/terminal-sessions/[id]")
    const upgrade = (
      handler as unknown as {
        upgrade: (request: { headers: Headers; url: string }) => Promise<Response | undefined>
      }
    ).upgrade
    const response = await upgrade({
      headers: new Headers({ origin }),
      url: "https://designer.example/api/projects/project/terminal-sessions/session",
    })
    expect(response?.status).toBe(401)
  })
  test("never uses the OS identity in hosted mode", () => {
    expect(() => getLocalUser()).toThrow("Local authentication is disabled")
  })

  test("denies unauthenticated direct manager routes before invoking managers", async () => {
    const launch = vi.fn()
    const caller = appRouter.createCaller({ operationManager: { launch } } as unknown as Services)
    await expect(caller.operation.launch({} as never)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    expect(launch).not.toHaveBeenCalled()
  })

  test("a valid login without a project grant cannot open terminals, launch operations, or subscribe to project data", async () => {
    const project = {
      designerAuthInitialization: {
        findUnique: vi.fn().mockResolvedValue({ id: "hosted-admin-v1" }),
      },
      user: { upsert: vi.fn() },
      role: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    }
    project.$transaction.mockImplementation(async callback => await callback(project))
    const getOrCreateSession = vi.fn()
    const launch = vi.fn()
    const subscribe = vi.fn()
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
      terminalManager: { getOrCreateSession },
      operationManager: { launch },
      pubsubManager: { subscribe },
      designerSessionToken: opaqueToken(),
    }
    const caller = appRouter.createCaller(
      services as unknown as Services & { designerSessionToken: string },
    )
    await expect(
      caller.terminal.getOrCreateTerminalSession({
        projectId: "project",
        terminalId: "terminal",
        newSession: false,
      }),
    ).rejects.toThrow()
    await expect(caller.operation.launch({ projectId: "project" } as never)).rejects.toThrow()
    await expect(caller.state.watchInstanceStates({ projectId: "project" })).rejects.toThrow()
    expect(getOrCreateSession).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })
})
