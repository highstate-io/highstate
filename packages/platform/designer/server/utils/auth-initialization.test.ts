import type { Services } from "@highstate/backend"
import { afterEach, expect, test, vi } from "vitest"
import { initializeHostedAuth, initializeHostedProjectAuth } from "./auth-initialization"

afterEach(() => vi.unstubAllEnvs())

test("seeds only explicit identities once per realm and preserves subsequent revocations", async () => {
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
    let initialized = false
    const userBinding = { upsert: vi.fn() }
    const groupBinding = { upsert: vi.fn() }
    const realm = {
      designerAuthInitialization: {
        findUnique: vi.fn(async () => (initialized ? { id: "hosted-admin-v1" } : null)),
        create: vi.fn(async () => {
          initialized = true
        }),
      },
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
  // Deleting a grant does not delete the independent initialization marker.
  backend.userBackendRoleBinding.upsert.mockClear()
  project.userGroupRoleBinding.upsert.mockClear()
  await initializeHostedAuth(services)
  await initializeHostedProjectAuth(services, "project")
  expect(backend.userBackendRoleBinding.upsert).not.toHaveBeenCalled()
  expect(project.userGroupRoleBinding.upsert).not.toHaveBeenCalled()
})
