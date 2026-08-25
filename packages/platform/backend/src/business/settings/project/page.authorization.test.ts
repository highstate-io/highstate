import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { PageSettingsService } from "./page"

describe("PageSettingsService authorization", () => {
  test("rejects page reads without page.get", async ({ database, project }) => {
    const service = new PageSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(createProjectRequestContext(project.id, grantProjectPermission("page.list")), {
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
  })

  test("requires page.get for existing page details", async ({ database, project }) => {
    const service = new PageSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()
  })
})
