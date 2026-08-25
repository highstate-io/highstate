import { describe, expect } from "vitest"
import { adminProjectContext, test } from "../../../test-utils"
import { ProjectRoleSettingsService } from "./role"
import { ProjectServiceAccountSettingsService } from "./service-account"

describe("ProjectServiceAccountSettingsService", () => {
  test("manages service accounts and role bindings", async ({ database, project }) => {
    const roles = new ProjectRoleSettingsService(database)
    const service = new ProjectServiceAccountSettingsService(database, roles)
    const context = adminProjectContext(project.id)
    const role = await roles.create(context, {
      meta: { title: "Operators" },
      rules: [{ permissions: ["instance-model.get"] }],
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
