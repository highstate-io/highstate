import { describe, expect } from "vitest"
import { adminBackendContext, test } from "../../../test-utils"
import { BackendRoleSettingsService } from "./role"

describe("BackendRoleSettingsService", () => {
  test("creates, queries, updates, and deletes roles", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const context = adminBackendContext()
    const role = await service.create(context, {
      meta: { title: "Operators" },
      rules: [{ permissions: ["project.get"] }],
    })

    await expect(service.get(context, role.id)).resolves.toMatchObject({
      id: role.id,
      meta: { title: "Operators" },
    })
    await expect(service.query(context, { search: role.id, pageSize: 10 })).resolves.toMatchObject({
      items: [{ id: role.id }],
    })

    await expect(
      service.update(context, role.id, {
        meta: { title: "Platform operators" },
        rules: [{ permissions: ["project.get", "project.list"] }],
      }),
    ).resolves.toMatchObject({ meta: { title: "Platform operators" } })

    await service.delete(context, role.id)
    await expect(service.get(context, role.id)).resolves.toBeNull()
  })

  test("validates role inputs", async ({ database }) => {
    const service = new BackendRoleSettingsService(database)
    const context = adminBackendContext()

    await expect(
      service.create(context, { meta: { title: "Invalid" }, rules: [] }),
    ).rejects.toThrow()
    await expect(
      service.create(context, {
        meta: { title: "Invalid" },
        rules: [{ permissions: ["unknown.permission"] }],
      } as never),
    ).rejects.toThrow()
  })
})
