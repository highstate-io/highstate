import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import {
  adminBackendContext,
  createBackendRequestContext,
  grantBackendPermission,
  test,
} from "../../../test-utils"
import { MemoryProjectUnlockBackend } from "../../../unlock"
import { BackendApiKeySettingsService } from "./api-key"
import { BackendRoleSettingsService } from "./role"
import { BackendServiceAccountSettingsService } from "./service-account"

describe("BackendApiKeySettingsService authorization", () => {
  test("requires api-key.list for collection access", async ({ database }) => {
    const service = new BackendApiKeySettingsService(database, {} as never, {} as never)

    await expect(service.query(createBackendRequestContext(), { pageSize: 1 })).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.query(createBackendRequestContext(grantBackendPermission("api-key.list")), {
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires permissions for API-key reads and writes", async ({ database }) => {
    const service = new BackendApiKeySettingsService(database, {} as never, {} as never)
    const context = createBackendRequestContext()

    await expect(service.get(context, "missing")).resolves.toBeNull()
    await expect(
      service.create(context, {
        meta: { title: "Key" },
        restrictionRules: [],
        expiresAt: null,
      }),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.update(context, "missing", {
        meta: { title: "Key" },
        restrictionRules: [],
        expiresAt: null,
      }),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(service.delete(context, "missing")).rejects.toThrow(PermissionDeniedError)
    await expect(service.getServiceAccountOptions(context)).rejects.toThrow(PermissionDeniedError)
  })

  test("does not require escalation for a permission-rule subset", async ({ database }) => {
    const roles = new BackendRoleSettingsService(database)
    const accounts = new BackendServiceAccountSettingsService(
      database,
      new MemoryProjectUnlockBackend(),
      roles,
    )
    const service = new BackendApiKeySettingsService(database, roles, accounts)
    const adminContext = adminBackendContext()
    const role = await roles.create(adminContext, {
      meta: { title: "Key role" },
      rules: [{ permissions: ["project.get"] }],
    })
    const account = await accounts.create(adminContext, { meta: { title: "Key account" } })
    await accounts.addRoleBinding(adminContext, role.id, account.id)
    const input = {
      meta: { title: "Key" },
      serviceAccountId: account.id,
      restrictionRules: [],
      expiresAt: null,
    }
    const createContext = createBackendRequestContext(
      new Map([
        ["api-key.create", [{ restrictions: [] }]],
        ["project.get", [{ restrictions: [] }]],
      ]),
    )

    const created = await service.create(createContext, input)
    await expect(
      service.update(
        createBackendRequestContext(
          new Map([
            [
              "api-key.update",
              [{ restrictions: [{ type: "resources", resourceIds: [created.apiKey.id] }] }],
            ],
            ["project.get", [{ restrictions: [] }]],
          ]),
        ),
        created.apiKey.id,
        input,
      ),
    ).resolves.toMatchObject({ id: created.apiKey.id })
  })
})
