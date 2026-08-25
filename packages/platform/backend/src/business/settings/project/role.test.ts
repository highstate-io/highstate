import { describe, expect } from "vitest"
import { adminProjectContext, test } from "../../../test-utils"
import { ProjectRoleSettingsService } from "./role"

describe("ProjectRoleSettingsService", () => {
  test("creates, queries, updates, and deletes roles", async ({ database, project }) => {
    const service = new ProjectRoleSettingsService(database)
    const context = adminProjectContext(project.id)
    const role = await service.create(context, {
      meta: { title: "Operators" },
      rules: [{ permissions: ["instance-model.get"] }],
    })

    await expect(service.get(context, role.id)).resolves.toMatchObject({
      meta: { title: "Operators" },
    })
    await expect(
      service.query(context, { search: "Operators", pageSize: 10 }),
    ).resolves.toMatchObject({ items: [{ id: role.id }] })
    await expect(
      service.update(context, role.id, {
        meta: { title: "Updated operators" },
        rules: [{ permissions: ["instance-model.get"] }],
      }),
    ).resolves.toMatchObject({ meta: { title: "Updated operators" } })

    await service.delete(context, role.id)
    await expect(service.get(context, role.id)).resolves.toBeNull()
  })
})
