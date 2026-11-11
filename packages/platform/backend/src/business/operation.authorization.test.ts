import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { OperationNotFoundError, PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { OperationService } from "./operation"

describe("OperationService authorization", () => {
  test("separates cancellation from reads and checks project ownership and every affected instance", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new OperationService(database, {} as never, {} as never, {} as never)
    const allowed = await createInstanceState(project.id)
    const denied = await createInstanceState(project.id)

    const operation = await projectDatabase.operation.create({
      data: {
        type: "update",
        meta: { title: "Operation" },
        options: {},
        requestedInstanceIds: [allowed.instanceId],
        phases: [
          {
            type: "update",
            instances: [allowed, denied].map(state => ({ id: state.instanceId, message: "test" })),
          },
        ],
      },
    })

    const restricted = createProjectRequestContext(
      project.id,
      grantProjectPermission("operation.cancel", [
        { type: "instances", instanceIds: [allowed.instanceId], recursive: false },
      ]),
    )

    await expect(
      service.authorizeCancellation(restricted, operation.id, allowed.instanceId),
    ).resolves.toBeUndefined()

    await expect(service.authorizeCancellation(restricted, operation.id)).rejects.toThrow(
      PermissionDeniedError,
    )

    await expect(
      service.authorizeCancellation(
        createProjectRequestContext(project.id, grantProjectPermission("operation.get")),
        operation.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)

    await expect(
      service.authorizeCancellation(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("operation.cancel", [
            { type: "resources", resourceIds: [operation.id] },
          ]),
        ),
        operation.id,
      ),
    ).resolves.toBeUndefined()

    await expect(
      service.authorizeCancellation(
        createProjectRequestContext("another-project", grantProjectPermission("operation.cancel")),
        operation.id,
      ),
    ).rejects.toThrow(OperationNotFoundError)
  })

  test("filters log history and denies streams outside the granted instance scope", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new OperationService(database, {} as never, {} as never, {} as never)
    const allowed = await createInstanceState(project.id)
    const denied = await createInstanceState(project.id)

    const operation = await projectDatabase.operation.create({
      data: {
        type: "update",
        meta: { title: "Operation" },
        options: {},
        requestedInstanceIds: [allowed.instanceId],
      },
    })

    for (const [index, stateId] of [allowed.id, denied.id, null].entries()) {
      await projectDatabase.operationLog.create({
        data: {
          id: `log-${index}`,
          operationId: operation.id,
          stateId,
          content: `content-${index}`,
        },
      })
    }

    const context = createProjectRequestContext(
      project.id,
      grantProjectPermission("operation.logs.get", [
        { type: "instances", instanceIds: [allowed.instanceId], recursive: false },
      ]),
    )

    expect(
      (await service.getOperationLogs(context, operation.id)).items.map(log => log.content),
    ).toEqual(["content-0"])

    await expect(
      service.authorizeLogAccess(context, operation.id, allowed.id),
    ).resolves.toBeUndefined()

    await expect(service.authorizeLogAccess(context, operation.id, denied.id)).rejects.toThrow(
      PermissionDeniedError,
    )

    await expect(
      service.authorizeLogAccess(
        createProjectRequestContext(
          "another-project",
          grantProjectPermission("operation.logs.get"),
        ),
        operation.id,
        allowed.id,
      ),
    ).rejects.toThrow(OperationNotFoundError)
  })

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
