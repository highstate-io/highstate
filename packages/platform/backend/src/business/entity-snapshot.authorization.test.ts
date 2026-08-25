import { describe, expect } from "vitest"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { EntitySnapshotService } from "./entity-snapshot"

describe("EntitySnapshotService authorization", () => {
  test("requires entity-snapshot.get for output snapshot reads", async ({ database, project }) => {
    const service = new EntitySnapshotService(database, {} as never, {} as never)

    await expect(
      service.listReferencedEntitySnapshotsForOutput(
        createProjectRequestContext(project.id),
        "missing",
        "missing",
      ),
    ).resolves.toEqual([])

    await expect(
      service.listReferencedEntitySnapshotsForOutput(
        createProjectRequestContext(project.id, grantProjectPermission("entity-snapshot.get")),
        "missing",
        "missing",
      ),
    ).resolves.toEqual([])
  })
})
