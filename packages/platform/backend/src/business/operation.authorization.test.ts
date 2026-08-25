import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { OperationService } from "./operation"

describe("OperationService authorization", () => {
  test("requires operation.list and operation.logs.get", async ({ database, project }) => {
    const service = new OperationService(database, {} as never, {} as never, {} as never)

    await expect(
      service.getOperations(createProjectRequestContext(project.id), {}),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.getOperationLogs(createProjectRequestContext(project.id), "missing", "missing"),
    ).rejects.toThrow(PermissionDeniedError)
    await expect(
      service.getOperations(
        createProjectRequestContext(project.id, grantProjectPermission("operation.list")),
        {},
      ),
    ).resolves.toBeDefined()
  })

  test("authorizes existing operations and logs by resource", async ({
    database,
    project,
    projectDatabase,
  }) => {
    const service = new OperationService(database, {} as never, {} as never, {} as never)
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
      service.getOperation(createProjectRequestContext(project.id), operation.id),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.getOperation(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.get", [
            { type: "resources", resourceIds: [operation.id] },
          ]),
        ),
        operation.id,
      ),
    ).resolves.toMatchObject({ id: operation.id })

    await expect(
      service.getOperationLogs(createProjectRequestContext(project.id), operation.id),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.getOperationLogs(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.logs.get", [
            { type: "resources", resourceIds: [operation.id] },
          ]),
        ),
        operation.id,
      ),
    ).resolves.toBeDefined()
  })
})
