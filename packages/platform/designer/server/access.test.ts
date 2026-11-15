import type { Services } from "@highstate/backend"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { accessRouter } from "./routers/access"
import { opaqueToken } from "./utils/hosted-session"

beforeEach(() => {
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
})
afterEach(() => vi.unstubAllEnvs())

function fixture() {
  const backendRoles = vi.fn().mockResolvedValue([
    {
      rules: [
        {
          permissions: ["project.list", "project.get"],
          restrictions: [{ type: "projects", projectIds: ["abcdefghijklmnopqrstuvwx"] }],
        },
      ],
    },
  ])

  const projectRoles = vi.fn().mockResolvedValue([
    {
      rules: [
        {
          permissions: ["secret.value.get", "secret.list"],
          restrictions: [{ type: "resources", resourceIds: ["visible"] }],
        },
      ],
    },
  ])

  const session = vi.fn().mockResolvedValue({
    userId: "human",
    identity: { id: "human", type: "oidc", meta: { title: "Human" }, groups: [] },
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60000),
  })

  const services = {
    designerSessionToken: opaqueToken(),
    database: {
      backend: {
        designerSession: { findUnique: session },
        backendRole: { findMany: backendRoles },
        project: { findUnique: vi.fn().mockResolvedValue(null) },
      },
      forProject: vi.fn().mockResolvedValue({
        user: { upsert: vi.fn() },
        role: { findMany: projectRoles },
        instanceState: { findMany: vi.fn().mockResolvedValue([]) },
      }),
    },
  } as unknown as Services & { designerSessionToken?: string }

  return {
    caller: accessRouter.createCaller(services),
    services,
    backendRoles,
    projectRoles,
    session,
  }
}

test("reports scoped collection access without granting create or out-of-scope targets", async () => {
  const { caller } = fixture()

  expect(
    await caller.backend({
      checks: [
        { key: "list", permission: "project.list", collection: true },
        { key: "create", permission: "project.create" },
        {
          key: "inside",
          permission: "project.get",
          target: { projectId: "abcdefghijklmnopqrstuvwx" },
        },
        {
          key: "outside",
          permission: "project.get",
          target: { projectId: "zyxwvutsrqponmlkjihgfedcb" },
        },
      ],
    }),
  ).toEqual([
    { key: "list", allowed: true },
    { key: "create", allowed: false },
    { key: "inside", allowed: true },
    { key: "outside", allowed: false },
  ])
})

test("uses project grants for individual resources and refreshes revoked roles", async () => {
  const { caller, projectRoles } = fixture()

  const checks = [
    { key: "inside", permission: "secret.value.get" as const, target: { resourceId: "visible" } },
    { key: "outside", permission: "secret.value.get" as const, target: { resourceId: "private" } },
  ]

  expect(await caller.project({ projectId: "project", checks })).toEqual([
    { key: "inside", allowed: true },
    { key: "outside", allowed: false },
  ])

  projectRoles.mockResolvedValue([])

  expect(await caller.project({ projectId: "project", checks })).toEqual([
    { key: "inside", allowed: false },
    { key: "outside", allowed: false },
  ])
})

test("resolves artifact hashes to authoritative resource IDs for download hints", async () => {
  const { caller, projectRoles, services } = fixture()

  projectRoles.mockResolvedValue([
    {
      rules: [
        {
          permissions: ["artifact.get"],
          restrictions: [{ type: "resources", resourceIds: ["visible"] }],
        },
      ],
    },
  ])

  const database = await services.database.forProject("project")

  Object.assign(database, {
    artifact: { findUnique: vi.fn().mockResolvedValue({ id: "visible" }) },
  })

  expect(
    await caller.project({
      projectId: "project",
      checks: [
        { key: "download", permission: "artifact.get", target: { artifactHash: "test-hash" } },
      ],
    }),
  ).toEqual([{ key: "download", allowed: true }])
})

test("rejects expired sessions instead of returning cached permissions", async () => {
  const { caller, session } = fixture()
  await caller.backend({ checks: [{ key: "create", permission: "project.create" }] })
  session.mockResolvedValue(null)

  await expect(
    caller.backend({ checks: [{ key: "create", permission: "project.create" }] }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
})

test("pushes live grant revocation and restoration without a frontend refresh", async () => {
  const { caller, backendRoles } = fixture()

  const stream = await caller.watch({
    checks: [{ realm: "backend", key: "list", permission: "project.list", collection: true }],
  })

  const iterator = stream[Symbol.asyncIterator]()
  expect((await iterator.next()).value).toEqual([{ key: "list", allowed: true }])
  backendRoles.mockResolvedValue([])
  expect((await iterator.next()).value).toEqual([{ key: "list", allowed: false }])
  backendRoles.mockResolvedValue([{ rules: [{ permissions: ["project.list"] }] }])
  expect((await iterator.next()).value).toEqual([{ key: "list", allowed: true }])
  await iterator.return?.()
})
