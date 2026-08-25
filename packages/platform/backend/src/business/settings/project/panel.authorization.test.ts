import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { PanelSettingsService } from "./panel"

describe("PanelSettingsService authorization", () => {
  test("requires panel.list for collection access", async ({ database, project }) => {
    const service = new PanelSettingsService(
      database,
      vi.mockObject({ isPanelAvailable: vi.fn().mockReturnValue(false) }) as never,
    )

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(createProjectRequestContext(project.id, grantProjectPermission("panel.list")), {
        pageSize: 1,
      }),
    ).resolves.toMatchObject({ items: [] })
  })
})
