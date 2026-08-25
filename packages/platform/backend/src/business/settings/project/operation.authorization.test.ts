import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../../../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../../../test-utils"
import { OperationSettingsService } from "./operation"

describe("OperationSettingsService authorization", () => {
  test("authorizes get by operation resource", async ({ database, project, projectDatabase }) => {
    const service = new OperationSettingsService(database)
    const operation = await projectDatabase.operation.create({
      data: {
        id: createId(),
        type: "preview",
        status: "completed",
        meta: { title: "Operation" },
        options: {},
        requestedInstanceIds: [],
      },
    })

    await expect(
      service.get(createProjectRequestContext(project.id), operation.id),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.get", [{ type: "resources", resourceIds: ["other"] }]),
        ),
        operation.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.get(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.get", [
            { type: "resources", resourceIds: [operation.id] },
          ]),
        ),
        operation.id,
      ),
    ).resolves.toMatchObject({ id: operation.id })
  })

  test("filters operations by resource restrictions", async ({
    database,
    project,
    projectDatabase,
  }) => {
    const service = new OperationSettingsService(database)
    const first = await projectDatabase.operation.create({
      data: {
        type: "preview",
        status: "completed",
        meta: { title: "First" },
        options: {},
        requestedInstanceIds: [],
      },
    })
    const second = await projectDatabase.operation.create({
      data: {
        type: "preview",
        status: "completed",
        meta: { title: "Second" },
        options: {},
        requestedInstanceIds: [],
      },
    })

    await expect(
      service.query(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.list", [
            { type: "resources", resourceIds: [first.id] },
          ]),
        ),
        { pageSize: 10 },
      ),
    ).resolves.toMatchObject({ items: [{ id: first.id }] })

    expect(first.id).not.toBe(second.id)
  })
})
