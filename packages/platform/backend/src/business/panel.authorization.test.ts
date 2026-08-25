import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { PanelService } from "./panel"

describe("PanelService authorization", () => {
  test("requires panel.update", async ({ database, project }) => {
    const service = new PanelService(
      database,
      {} as never,
      vi.mockObject({ assertInstance: vi.fn(), setPanels: vi.fn() } as never),
    )

    await expect(
      service.setUnitPanels(
        createProjectRequestContext(project.id),
        "missing",
        "missing",
        "missing",
        [],
        "missing",
      ),
    ).rejects.not.toThrow(PermissionDeniedError)

    await expect(
      service.setUnitPanels(
        createProjectRequestContext(project.id, grantProjectPermission("panel.update")),
        "missing",
        "missing",
        "missing",
        [],
        "missing",
      ),
    ).rejects.not.toThrow(PermissionDeniedError)
  })
})
