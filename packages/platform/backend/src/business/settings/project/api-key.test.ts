import { describe, expect } from "vitest"
import { adminProjectContext, test } from "../../../test-utils"
import { ProjectApiKeySettingsService } from "./api-key"
import { ProjectRoleSettingsService } from "./role"
import { ProjectServiceAccountSettingsService } from "./service-account"

describe("ProjectApiKeySettingsService", () => {
  test("creates, queries, updates, and deletes API keys", async ({ database, project }) => {
    const roles = new ProjectRoleSettingsService(database)
    const accounts = new ProjectServiceAccountSettingsService(database, roles)
    const service = new ProjectApiKeySettingsService(database, roles, accounts)
    const context = adminProjectContext(project.id)
    const account = await accounts.create(context, { meta: { title: "Automation" } })
    const created = await service.create(context, {
      meta: { title: "Integration key" },
      serviceAccountId: account.id,
      restrictionRules: [],
      expiresAt: null,
    })

    expect(created.token).toMatch(new RegExp(`^hcp_${created.apiKey.id}_[a-z][0-9a-z]{23}$`))
    await expect(
      service.query(context, { search: "Integration", pageSize: 10 }),
    ).resolves.toMatchObject({ items: [{ id: created.apiKey.id }] })
    await expect(
      service.update(context, created.apiKey.id, {
        meta: { title: "Updated integration key" },
        serviceAccountId: account.id,
        restrictionRules: [],
        expiresAt: null,
      }),
    ).resolves.toMatchObject({ meta: { title: "Updated integration key" } })

    await service.delete(context, created.apiKey.id)
    await expect(service.get(context, created.apiKey.id)).resolves.toBeNull()
  })
})
