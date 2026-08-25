import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createBackendRequestContext, grantBackendPermission, test } from "../test-utils"
import { ProjectUnlockService } from "./project-unlock"

describe("ProjectUnlockService authorization", () => {
  test("requires project.get and project.unlock independently", async ({ database }) => {
    const service = new ProjectUnlockService(
      database,
      {} as never,
      {} as never,
      {} as never,
      { HIGHSTATE_ENCRYPTION_ENABLED: false, HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS: [] },
      {} as never,
    )
    vi.spyOn(database.backend.project, "findUnique").mockResolvedValue(null)

    await expect(
      service.getProjectUnlockState(createBackendRequestContext(), "missing"),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.unlockProject(createBackendRequestContext(), "missing", {} as never),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.getProjectUnlockState(
        createBackendRequestContext(grantBackendPermission("project.get")),
        "missing",
      ),
    ).rejects.not.toThrow(PermissionDeniedError)
    await expect(
      service.unlockProject(
        createBackendRequestContext(grantBackendPermission("project.unlock")),
        "missing",
        {} as never,
      ),
    ).rejects.not.toThrow(PermissionDeniedError)
  })
})
