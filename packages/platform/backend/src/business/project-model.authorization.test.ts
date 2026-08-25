import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { ProjectModelService } from "./project-model"

describe("ProjectModelService authorization", () => {
  test("requires instance-model.get", async ({ database, project }) => {
    const service = new ProjectModelService(
      database,
      {} as never,
      {} as never,
      {},
      { registerUnlockTask: vi.fn() } as never,
      {} as never,
    )
    vi.spyOn(service, "getProjectModelCore").mockResolvedValue([] as never)

    await expect(service.getProjectModel(createProjectRequestContext(project.id))).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.getProjectModel(
        createProjectRequestContext(project.id, grantProjectPermission("instance-model.get")),
      ),
    ).resolves.toBeDefined()
  })
})
