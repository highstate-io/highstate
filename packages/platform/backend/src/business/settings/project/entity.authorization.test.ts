import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { EntitySettingsService } from "./entity"

describe("EntitySettingsService authorization", () => {
  test("requires entity.list and entity-snapshot.list for collections", async ({
    database,
    project,
  }) => {
    const service = new EntitySettingsService(database)

    await expect(
      service.queryEntities(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.queryEntities(
        createProjectRequestContext(project.id, grantProjectPermission("entity.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
    await expect(
      service.queryEntitySnapshotsForEntity(createProjectRequestContext(project.id), "missing", {
        pageSize: 1,
      }),
    ).rejects.toThrow(PermissionDeniedError)
  })
})
