import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createBackendRequestContext, grantBackendPermission, test } from "../test-utils"
import { ProjectService } from "./project"

describe("ProjectService authorization", () => {
  test("requires project.list for collection access", async ({ database }) => {
    const service = new ProjectService(
      database,
      {} as never,
      {} as never,
      {} as never,
      {},
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(service.getProjects(createBackendRequestContext(), {})).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.getProjects(createBackendRequestContext(grantBackendPermission("project.list")), {}),
    ).resolves.toBeDefined()
  })
})
