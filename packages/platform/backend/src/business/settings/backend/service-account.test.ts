import { describe, expect } from "vitest"
import { adminBackendContext, test } from "../../../test-utils"
import { MemoryProjectUnlockBackend } from "../../../unlock"
import { BackendRoleSettingsService } from "./role"
import { BackendServiceAccountSettingsService } from "./service-account"

describe("BackendServiceAccountSettingsService", () => {
  test("manages service accounts and role bindings", async ({ database }) => {
    const roles = new BackendRoleSettingsService(database)
    const service = new BackendServiceAccountSettingsService(
      database,
      new MemoryProjectUnlockBackend(),
      roles,
    )
    const context = adminBackendContext()
    const role = await roles.create(context, {
      meta: { title: "Operators" },
      rules: [{ permissions: ["project.get"] }],
    })
    const account = await service.create(context, { meta: { title: "Automation" } })

    await service.addRoleBinding(context, role.id, account.id)
    await expect(service.getRoleBindings(context, account.id)).resolves.toContainEqual(
      expect.objectContaining({ roleId: role.id, serviceAccountId: account.id }),
    )

    await service.removeRoleBinding(context, role.id, account.id)
    await expect(service.getRoleBindings(context, account.id)).resolves.toEqual([])

    await expect(
      service.update(context, account.id, { meta: { title: "Updated automation" } }),
    ).resolves.toMatchObject({ meta: { title: "Updated automation" } })
    await service.delete(context, account.id)
    await expect(service.get(context, account.id)).resolves.toBeNull()
  })
})
