import { describe, expect } from "vitest"
import { adminBackendContext, test } from "../../../test-utils"
import { MemoryProjectUnlockBackend } from "../../../unlock"
import { BackendApiKeySettingsService } from "./api-key"
import { BackendRoleSettingsService } from "./role"
import { BackendServiceAccountSettingsService } from "./service-account"

describe("BackendApiKeySettingsService", () => {
  test("creates, queries, updates, and deletes API keys", async ({ database }) => {
    const roles = new BackendRoleSettingsService(database)
    const accounts = new BackendServiceAccountSettingsService(
      database,
      new MemoryProjectUnlockBackend(),
      roles,
    )
    const service = new BackendApiKeySettingsService(database, roles, accounts)
    const context = adminBackendContext()
    const account = await accounts.create(context, { meta: { title: "Automation" } })
    const created = await service.create(context, {
      meta: { title: "Deployment key" },
      serviceAccountId: account.id,
      restrictionRules: [],
      expiresAt: null,
    })

    expect(created.token).toMatch(new RegExp(`^hcb_${created.apiKey.id}_[a-z][0-9a-z]{23}$`))
    await expect(
      service.query(context, { search: "Deployment", pageSize: 10 }),
    ).resolves.toMatchObject({ items: [{ id: created.apiKey.id }] })
    await expect(
      service.update(context, created.apiKey.id, {
        meta: { title: "Updated deployment key" },
        serviceAccountId: account.id,
        restrictionRules: [],
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ meta: { title: "Updated deployment key" } })

    await service.delete(context, created.apiKey.id)
    await expect(service.get(context, created.apiKey.id)).resolves.toBeNull()
  })
})
