import type { Services } from "@highstate/backend"
import { afterEach, expect, test, vi } from "vitest"
import { initializeHostedAuth, initializeHostedProjectAuth } from "./auth-initialization"

afterEach(() => vi.unstubAllEnvs())

test("reapplies configured administrator grants in both realms on initialization", async () => {
  vi.stubEnv("HIGHSTATE_BACKEND_DATABASE_TYPE", "postgresql")
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
  vi.stubEnv("HIGHSTATE_AUTH_ADMIN_USER_IDS", '["x123456789012345678901234"]')
  vi.stubEnv("HIGHSTATE_AUTH_ADMIN_GROUP_IDS", '["y123456789012345678901234"]')
  const createRealm = () => {
    const userBinding = { upsert: vi.fn() }
    const groupBinding = { upsert: vi.fn() }
    const realm = {
      backendRole: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "admin-role" }) },
      role: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "admin-role" }) },
      user: { upsert: vi.fn() },
      userGroup: { upsert: vi.fn() },
      userBackendRoleBinding: userBinding,
      userRoleBinding: userBinding,
      userGroupBackendRoleBinding: groupBinding,
      userGroupRoleBinding: groupBinding,
      $transaction: vi.fn(),
    }
    realm.$transaction.mockImplementation(async callback => await callback(realm))
    return realm
  }
  const backend = createRealm()
  const project = createRealm()
  const services = {
    database: { backend, forProject: vi.fn().mockResolvedValue(project) },
  } as unknown as Services
  await initializeHostedAuth(services)
  await initializeHostedProjectAuth(services, "project")
  expect(backend.userBackendRoleBinding.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: { roleId: "admin-role", userId: "x123456789012345678901234" },
    }),
  )
  expect(project.userGroupRoleBinding.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: { roleId: "admin-role", groupId: "y123456789012345678901234" },
    }),
  )
  // A removed configured grant is restored on the next initialization.
  backend.userBackendRoleBinding.upsert.mockClear()
  project.userGroupRoleBinding.upsert.mockClear()
  await initializeHostedAuth(services)
  await initializeHostedProjectAuth(services, "project")
  expect(backend.userBackendRoleBinding.upsert).toHaveBeenCalledTimes(1)
  expect(project.userGroupRoleBinding.upsert).toHaveBeenCalledTimes(1)
  expect(backend.userBackendRoleBinding.upsert).toHaveBeenCalledWith({
    where: { roleId_userId: { roleId: "admin-role", userId: "x123456789012345678901234" } },
    create: { roleId: "admin-role", userId: "x123456789012345678901234" },
    update: {},
  })
  expect(project.userGroupRoleBinding.upsert).toHaveBeenCalledWith({
    where: { roleId_groupId: { roleId: "admin-role", groupId: "y123456789012345678901234" } },
    create: { roleId: "admin-role", groupId: "y123456789012345678901234" },
    update: {},
  })
})
