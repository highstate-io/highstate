import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { WorkerSettingsService } from "./worker"

describe("WorkerSettingsService authorization", () => {
  test("requires worker and worker-version list permissions independently", async ({
    database,
    project,
  }) => {
    const service = new WorkerSettingsService(database)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("worker.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
    await expect(
      service.queryVersions(createProjectRequestContext(project.id), "missing", { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("requires get permissions for existing worker resources", async ({ database, project }) => {
    const service = new WorkerSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()

    await expect(
      service.getVersion(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()
  })
})
