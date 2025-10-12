import type { InstanceId } from "@highstate/contract"
import type { PubSubManager } from "../pubsub"
import type { OperationOptions } from "../shared"
import { createId } from "@paralleldrive/cuid2"
import { describe, type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { OperationService } from "./operation"

const operationTest = test.extend<{
  pubsubManager: MockedObject<PubSubManager>
  operationService: OperationService
}>({
  pubsubManager: async ({}, use) => {
    const pubsubManager = vi.mockObject({
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      publishMany: vi.fn().mockResolvedValue(undefined),
    } as unknown as PubSubManager)

    await use(pubsubManager)
  },

  operationService: async ({ database, pubsubManager, logger }, use) => {
    const service = new OperationService(
      database,
      pubsubManager,
      logger.child({ service: "OperationService" }),
    )

    await use(service)
  },
})

describe("createOperation", () => {
  operationTest(
    "successfully creates new operation",
    async ({
      operationService,
      projectDatabase,
      project,
      pubsubManager,
      createInstanceState,
      expect,
    }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const meta = { title: "Test Operation" }
      const type = "update" as const
      const requestedInstanceIds = [instance.instanceId] as InstanceId[]
      const options = { forceUpdateDependencies: false } as OperationOptions

      // act
      const operation = await operationService.createOperation(
        project.id,
        meta,
        type,
        requestedInstanceIds,
        options,
      )

      // assert
      expect(operation).toBeDefined()
      expect(operation.meta).toEqual(meta)
      expect(operation.type).toBe(type)
      expect(operation.requestedInstanceIds).toEqual(requestedInstanceIds)
      expect(operation.options).toEqual(options)
      expect(operation.startedAt).toBeInstanceOf(Date)
      expect(operation.finishedAt).toBeNull()

      // verify operation was created in database
      const dbOperation = await projectDatabase.operation.findUnique({
        where: { id: operation.id },
      })
      expect(dbOperation).toBeDefined()
      expect(dbOperation?.id).toBe(operation.id)

      // verify publish was called
      expect(pubsubManager.publish).toHaveBeenCalledWith(["operation", project.id], {
        type: "updated",
        operation,
      })
    },
  )
})

describe("updateOperation", () => {
  operationTest(
    "successfully updates operation",
    async ({ operationService, projectDatabase, project, pubsubManager, expect }) => {
      // arrange
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: ["server.v1:test"],
          startedAt: new Date(),
        },
      })

      // act
      const updatedOperation = await operationService.updateOperation(project.id, operation.id, {
        meta: { title: "Updated Operation" },
      })

      // assert
      expect(updatedOperation.meta).toEqual({ title: "Updated Operation" })
      expect(updatedOperation.id).toBe(operation.id)

      // verify operation was updated in database
      const dbOperation = await projectDatabase.operation.findUnique({
        where: { id: operation.id },
      })
      expect(dbOperation?.meta).toEqual({ title: "Updated Operation" })

      // verify publish was called
      expect(pubsubManager.publish).toHaveBeenCalledWith(["operation", project.id], {
        type: "updated",
        operation: updatedOperation,
      })
    },
  )

  operationTest(
    "throws error when operation not found",
    async ({ operationService, project, expect }) => {
      // arrange
      const nonExistentId = "nonexistent"

      // act & assert
      await expect(
        operationService.updateOperation(project.id, nonExistentId, {}),
      ).rejects.toThrow()
    },
  )
})

describe("getOperation", () => {
  operationTest(
    "returns operation when found",
    async ({ operationService, projectDatabase, project, expect }) => {
      // arrange
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: ["server.v1:test"],
          startedAt: new Date(),
        },
      })

      // act
      const result = await operationService.getOperation(project.id, operation.id)

      // assert
      expect(result).toBeDefined()
      expect(result?.id).toBe(operation.id)
      expect(result?.meta).toEqual(operation.meta)
    },
  )

  operationTest(
    "returns undefined when operation not found",
    async ({ operationService, project, expect }) => {
      // arrange
      const nonExistentId = "nonexistent"

      // act
      const result = await operationService.getOperation(project.id, nonExistentId)

      // assert
      expect(result).toBeUndefined()
    },
  )
})

describe("getOperations", () => {
  operationTest(
    "returns operations ordered by startedAt desc",
    async ({ operationService, projectDatabase, project, expect }) => {
      // clean up any existing operations first
      await projectDatabase.operation.deleteMany({})

      // arrange
      const operation1 = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Operation 1" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date("2023-01-01"),
        },
      })

      const operation2 = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Operation 2" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date("2023-01-02"),
        },
      })

      // act
      const operations = await operationService.getOperations(project.id)

      // assert
      expect(operations).toHaveLength(2)
      expect(operations[0].id).toBe(operation2.id) // newer operation first
      expect(operations[1].id).toBe(operation1.id)
    },
  )

  operationTest(
    "respects limit parameter",
    async ({ operationService, projectDatabase, project, expect }) => {
      // clean up any existing operations first
      await projectDatabase.operation.deleteMany({})

      // arrange
      await projectDatabase.operation.createMany({
        data: [
          {
            id: createId(),
            meta: { title: "Operation 1" },
            type: "update",
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-01"),
          },
          {
            id: createId(),
            meta: { title: "Operation 2" },
            type: "update",
            options: {},
            requestedInstanceIds: [],
            startedAt: new Date("2023-01-02"),
          },
        ],
      })

      // act
      const operations = await operationService.getOperations(project.id, 1)

      // assert
      expect(operations).toHaveLength(1)
    },
  )

  operationTest(
    "returns empty array when no operations exist",
    async ({ operationService, projectDatabase, project, expect }) => {
      // clean up any existing operations first
      await projectDatabase.operation.deleteMany({})

      // act
      const operations = await operationService.getOperations(project.id)

      // assert
      expect(operations).toEqual([])
    },
  )
})

describe("getOperationLogs", () => {
  operationTest(
    "returns logs for operation",
    async ({ operationService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instance = await createInstanceState(project.id)
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date(),
        },
      })

      await projectDatabase.operationLog.createMany({
        data: [
          {
            id: "log1",
            operationId: operation.id,
            stateId: instance.id,
            content: "Log 1",
          },
          {
            id: "log2",
            operationId: operation.id,
            stateId: null,
            content: "Log 2",
          },
        ],
      })

      // act
      const logs = await operationService.getOperationLogs(project.id, operation.id)

      // assert
      expect(logs).toHaveLength(2)
      expect(logs.map(l => l.content)).toEqual(["Log 1", "Log 2"])
    },
  )

  operationTest(
    "filters logs by instanceId when provided",
    async ({ operationService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const targetInstance = await createInstanceState(project.id)
      const otherInstance = await createInstanceState(project.id)
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date(),
        },
      })

      await projectDatabase.operationLog.createMany({
        data: [
          {
            id: createId(),
            operationId: operation.id,
            stateId: targetInstance.id,
            content: "Target log",
          },
          {
            id: createId(),
            operationId: operation.id,
            stateId: otherInstance.id,
            content: "Other log",
          },
        ],
      })

      // act
      const logs = await operationService.getOperationLogs(
        project.id,
        operation.id,
        targetInstance.id,
      )

      // assert
      expect(logs).toHaveLength(1)
      expect(logs[0].content).toBe("Target log")
      expect(logs[0].stateId).toBe(targetInstance.id)
    },
  )

  operationTest(
    "returns empty array when no logs exist",
    async ({ operationService, projectDatabase, project, expect }) => {
      // arrange
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date(),
        },
      })

      // act
      const logs = await operationService.getOperationLogs(project.id, operation.id)

      // assert
      expect(logs).toEqual([])
    },
  )
})

describe("completeOperation", () => {
  operationTest(
    "successfully completes operation",
    async ({ operationService, projectDatabase, project, pubsubManager, expect }) => {
      // arrange
      const operation = await projectDatabase.operation.create({
        data: {
          id: createId(),
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: [],
          startedAt: new Date(),
        },
      })

      // act
      const completedOperation = await operationService.markOperationFinished(
        project.id,
        operation.id,
        "completed",
      )

      // assert
      expect(completedOperation.finishedAt).toBeInstanceOf(Date)
      expect(completedOperation.id).toBe(operation.id)

      // verify operation was updated in database
      const dbOperation = await projectDatabase.operation.findUnique({
        where: { id: operation.id },
      })
      expect(dbOperation?.finishedAt).toBeInstanceOf(Date)

      // verify publish was called
      expect(pubsubManager.publish).toHaveBeenCalledWith(["operation", project.id], {
        type: "updated",
        operation: completedOperation,
      })
    },
  )

  operationTest(
    "throws error when operation not found",
    async ({ operationService, project, expect }) => {
      // arrange
      const nonExistentId = "nonexistent"

      // act & assert
      await expect(
        operationService.markOperationFinished(project.id, nonExistentId, "completed"),
      ).rejects.toThrow()
    },
  )
})
