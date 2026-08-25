import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { TriggerSettingsService } from "./trigger"

describe("TriggerSettingsService authorization", () => {
  test("requires trigger.list for collection access", async ({ database, project }) => {
    const service = new TriggerSettingsService(database)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("trigger.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires trigger.get for existing trigger details", async ({ database, project }) => {
    const service = new TriggerSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()
  })
})
