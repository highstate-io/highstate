import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { UnlockMethodSettingsService } from "./unlock-method"

describe("UnlockMethodSettingsService authorization", () => {
  test("requires unlock-method.list", async ({ database, project }) => {
    const service = new UnlockMethodSettingsService(database, {} as never)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("unlock-method.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires permissions for unlock-method writes", async ({ database, project }) => {
    const service = new UnlockMethodSettingsService(database, {} as never)
    const context = createProjectRequestContext(project.id)

    await expect(service.get(context, "missing")).resolves.toBeNull()
    await expect(service.create(context, {} as never)).rejects.toThrow(PermissionDeniedError)
    await expect(service.delete(context, "missing")).rejects.toThrow(PermissionDeniedError)
  })
})
