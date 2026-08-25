import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { ArtifactSettingsService } from "./artifact"

describe("ArtifactSettingsService authorization", () => {
  test("authorizes get by artifact resource", async ({ database, project, projectDatabase }) => {
    const service = new ArtifactSettingsService(database)
    const artifact = await projectDatabase.artifact.create({
      data: {
        id: createId(),
        hash: createId(),
        size: 1,
        chunkSize: 1,
        meta: { title: "Artifact" },
      },
    })

    await expect(service.get(createProjectRequestContext(project.id), artifact.id)).rejects.toThrow(
      PermissionDeniedError,
    )
    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("artifact.get", [
            { type: "resources", resourceIds: [artifact.id] },
          ]),
        ),
        artifact.id,
      ),
    ).resolves.toMatchObject({ id: artifact.id })
  })

  test("filters artifacts by resource restrictions", async ({
    database,
    project,
    projectDatabase,
  }) => {
    const service = new ArtifactSettingsService(database)
    const first = await projectDatabase.artifact.create({
      data: { id: createId(), hash: createId(), size: 1, chunkSize: 1, meta: { title: "First" } },
    })
    const second = await projectDatabase.artifact.create({
      data: { id: createId(), hash: createId(), size: 1, chunkSize: 1, meta: { title: "Second" } },
    })

    await expect(
      service.query(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("artifact.list", [{ type: "resources", resourceIds: [first.id] }]),
        ),
        { pageSize: 10 },
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] })

    expect(first.id).not.toBe(second.id)
  })
})
