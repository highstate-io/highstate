import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { TerminalSettingsService } from "./terminal"

describe("TerminalSettingsService authorization", () => {
  test("requires terminal.list for collection access", async ({ database, project }) => {
    const service = new TerminalSettingsService(database)

    await expect(
      service.query(createProjectRequestContext(project.id), { pageSize: 1 }),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.query(
        createProjectRequestContext(project.id, grantProjectPermission("terminal.list")),
        { pageSize: 1 },
      ),
    ).resolves.toMatchObject({ items: [] })
  })

  test("filters terminal collections and denies unrelated terminal reads", async ({
    database,
    project,
    projectDatabase,
  }) => {
    const service = new TerminalSettingsService(database)
    const first = await projectDatabase.terminal.create({
      data: {
        id: createId(),
        meta: { title: "First" },
        spec: {},
      },
    })
    const second = await projectDatabase.terminal.create({
      data: {
        id: createId(),
        meta: { title: "Second" },
        spec: {},
      },
    })
    const context = createProjectRequestContext(
      project.id,
      grantProjectPermission("terminal.list", [{ type: "resources", resourceIds: [first.id] }]),
    )

    await expect(service.query(context, { pageSize: 10 })).resolves.toMatchObject({
      items: [{ id: first.id }],
    })
    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("terminal.get", [{ type: "resources", resourceIds: [first.id] }]),
        ),
        second.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)
  })
})
