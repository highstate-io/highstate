import { describe, expect, vi } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { LibraryService } from "./library"

describe("LibraryService authorization", () => {
  test("requires instance-model.get for all public model reads", async ({ database, project }) => {
    const service = new LibraryService(database, {} as never, {} as never, {} as never)
    const context = createProjectRequestContext(project.id)
    vi.spyOn(service, "getVirtualComponentsCore").mockResolvedValue({})
    vi.spyOn(service, "getLibraryModelCore").mockResolvedValue({} as never)

    await expect(service.getVirtualComponents(context)).rejects.toThrow(PermissionDeniedError)

    await expect(service.getLibraryModel(context)).rejects.toThrow(PermissionDeniedError)

    await expect(service.getComponents(context, {})).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.getVirtualComponents(
        createProjectRequestContext(project.id, grantProjectPermission("instance-model.get")),
      ),
    ).resolves.toEqual({})
  })
})
