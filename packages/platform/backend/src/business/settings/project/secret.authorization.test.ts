import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { SecretSettingsService } from "./secret"

describe("SecretSettingsService authorization", () => {
  test("requires separate metadata and value permissions", async ({ database, project }) => {
    const service = new SecretSettingsService(database)

    await expect(
      service.get(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()

    await expect(
      service.getValue(createProjectRequestContext(project.id), "missing"),
    ).resolves.toBeNull()

    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("secret.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("requires secret.list for collection access", async ({ database, project }) => {
    const service = new SecretSettingsService(database)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  test("filters secret metadata and keeps values behind a separate resource grant", async ({
    database,
    project,
    projectDatabase,
  }) => {
    const service = new SecretSettingsService(database)
    const first = await projectDatabase.secret.create({
      data: {
        id: createId(),
        meta: { title: "First" },
        content: "first-value",
      },
    })
    const second = await projectDatabase.secret.create({
      data: {
        id: createId(),
        meta: { title: "Second" },
        content: "second-value",
      },
    })

    await expect(
      service.query(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("secret.list", [{ type: "resources", resourceIds: [first.id] }]),
        ),
        { pageSize: 10 },
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] })

    await expect(
      service.getValue(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("secret.value.get", [
            { type: "resources", resourceIds: [second.id] },
          ]),
        ),
        first.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)
  })
})
