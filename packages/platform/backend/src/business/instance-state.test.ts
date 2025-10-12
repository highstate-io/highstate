import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { ArtifactService } from "../artifact"
import type { PubSubManager } from "../pubsub"
import type { RunnerBackend } from "../runner"
import type { ProjectService } from "./project"
import type { SecretService } from "./secret"
import type { UnitExtraService } from "./unit-extra"
import type { WorkerService } from "./worker"
import { parseInstanceId } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { describe, type MockedObject, vi } from "vitest"
import { InstanceLockedError, InstanceStateNotFoundError } from "../shared"
import { test } from "../test-utils"
import { InstanceStateService } from "./instance-state"

const instanceStateTest = test.extend<{
  pubsubManager: MockedObject<PubSubManager>
  projectService: MockedObject<ProjectService>
  runnerBackend: MockedObject<RunnerBackend>
  workerService: MockedObject<WorkerService>
  artifactService: MockedObject<ArtifactService>
  unitExtraService: MockedObject<UnitExtraService>
  secretService: MockedObject<SecretService>
  instanceStateService: InstanceStateService
}>({
  pubsubManager: async ({}, use) => {
    const pubsubManager = vi.mockObject({
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      publishMany: vi.fn().mockResolvedValue(undefined),
    } as unknown as PubSubManager)

    await use(pubsubManager)
  },

  projectService: async ({}, use) => {
    const projectService = vi.mockObject({
      getProjectOrThrow: vi.fn(),
    } as unknown as ProjectService)

    await use(projectService)
  },

  runnerBackend: async ({}, use) => {
    const runnerBackend = vi.mockObject({
      deleteState: vi.fn().mockResolvedValue(undefined),
    } as unknown as RunnerBackend)

    await use(runnerBackend)
  },

  workerService: async ({}, use) => {
    const workerService = vi.mockObject({
      cleanupWorkerUsageAndSync: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkerService)

    await use(workerService)
  },

  artifactService: async ({}, use) => {
    const artifactService = vi.mockObject({
      collectGarbage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArtifactService)

    await use(artifactService)
  },

  unitExtraService: async ({}, use) => {
    const unitExtraService = vi.mockObject({
      processUnitPages: vi.fn().mockResolvedValue([]),
      processUnitTerminals: vi.fn().mockResolvedValue([]),
      processUnitTriggers: vi.fn().mockResolvedValue([]),
      pruneInstanceArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as UnitExtraService)
    await use(unitExtraService)
  },

  secretService: async ({}, use) => {
    const secretService = vi.mockObject({} as unknown as SecretService)
    await use(secretService)
  },

  instanceStateService: async (
    {
      database,
      pubsubManager,
      runnerBackend,
      workerService,
      artifactService,
      unitExtraService,
      secretService,
      logger,
    },
    use,
  ) => {
    const service = new InstanceStateService(
      database,
      pubsubManager,
      runnerBackend,
      workerService,
      artifactService,
      unitExtraService,
      secretService,
      logger.child({ service: "InstanceStateService" }),
    )

    await use(service)
  },
})

describe("getInstanceStates", () => {
  instanceStateTest(
    "successfully retrieves instance states",
    async ({ instanceStateService, project, createInstanceState, expect }) => {
      // arrange
      const instanceState1 = await createInstanceState(project.id)
      const instanceState2 = await createInstanceState(project.id)

      // act
      const instanceStates = await instanceStateService.getInstanceStates(project.id)

      // assert
      expect(instanceStates).toHaveLength(2)
      expect(instanceStates.map(i => i.id)).toEqual([instanceState1.id, instanceState2.id])
      expect(instanceStates[0].secretNames).toEqual([])
      expect(instanceStates[0].lastOperationState).toBeUndefined()
    },
  )

  instanceStateTest(
    "includes evaluation states when requested",
    async ({ instanceStateService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      await projectDatabase.instanceEvaluationState.create({
        data: {
          stateId: instanceState.id,
          status: "evaluated",
          model: {
            id: "test.v1:example",
            kind: "unit",
            type: "test.v1",
            name: "example",
            args: {},
            inputs: {},
          },
        },
      })

      // act
      const instanceStates = await instanceStateService.getInstanceStates(project.id, {
        includeEvaluationState: true,
      })

      // assert
      const instanceWithEvaluation = instanceStates.find(state => state.id === instanceState.id)
      expect(instanceWithEvaluation).toBeDefined()
      expect(instanceWithEvaluation?.evaluationState).toBeDefined()
      expect(instanceWithEvaluation?.evaluationState?.status).toBe("evaluated")
    },
  )
})

describe("forgetInstanceState", () => {
  instanceStateTest(
    "successfully deletes instance with no operation state",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      pubsubManager,
      workerService,
      artifactService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)
      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
      )

      // assert
      const updatedState = await projectDatabase.instanceState.findUnique({
        where: { id: instanceState.id },
      })
      expect(updatedState?.status).toBe("undeployed")
      expect(updatedState?.statusFields).toBeNull()
      expect(updatedState?.inputHash).toBeNull()
      expect(updatedState?.outputHash).toBeNull()
      expect(updatedState?.dependencyOutputHash).toBeNull()

      // verify side effects were called
      expect(workerService.cleanupWorkerUsageAndSync).toHaveBeenCalledWith(project.id)
      expect(artifactService.collectGarbage).toHaveBeenCalledWith(project.id)
      expect(pubsubManager.publish).toHaveBeenCalledWith(
        ["instance-state", project.id],
        expect.objectContaining({
          type: "patched",
          stateId: instanceState.id,
          patch: expect.objectContaining({
            status: "undeployed",
          }),
        }),
      )
    },
  )

  instanceStateTest(
    "successfully deletes instance with destroyed operation state",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      // create operation with destroyed status
      const operationId = createId()
      await projectDatabase.operation.create({
        data: {
          id: operationId,
          meta: { title: "Test Operation" },
          type: "destroy",
          options: {},
          requestedInstanceIds: [instanceState.instanceId],
          startedAt: new Date(),
        },
      })

      await projectDatabase.instanceOperationState.create({
        data: {
          operationId,
          stateId: instanceState.id,
          status: "updated",
          model: {} as InstanceModel,
          resolvedInputs: {},
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
      )

      // assert
      const updatedState = await projectDatabase.instanceState.findUnique({
        where: { id: instanceState.id },
      })
      expect(updatedState?.status).toBe("undeployed")
    },
  )

  instanceStateTest(
    "successfully deletes instance with active operation state",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      // create operation with pending status
      const operationId = createId()
      await projectDatabase.operation.create({
        data: {
          id: operationId,
          meta: { title: "Test Operation" },
          type: "update",
          options: {},
          requestedInstanceIds: [instanceState.instanceId],
          startedAt: new Date(),
        },
      })

      await projectDatabase.instanceOperationState.create({
        data: {
          operationId,
          stateId: instanceState.id,
          status: "updating",
          model: {} as InstanceModel,
          resolvedInputs: {},
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
      )

      // assert
      const updatedState = await projectDatabase.instanceState.findUnique({
        where: { id: instanceState.id },
      })
      expect(updatedState?.status).toBe("undeployed")
    },
  )

  instanceStateTest(
    "throws error when instance has active locks",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      await projectDatabase.instanceLock.create({
        data: {
          stateId: instanceState.id,
          token: "test-lock-token",
          meta: { title: "Test Lock" },
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act & assert
      await expect(
        instanceStateService.forgetInstanceState(
          project.id,
          instanceState.instanceId as InstanceId,
        ),
      ).rejects.toThrow(InstanceLockedError)
    },
  )

  instanceStateTest(
    "handles terminal data when clearTerminalData=true",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      // create service account for terminal
      const serviceAccount = await projectDatabase.serviceAccount.create({
        data: {
          id: createId(),
          meta: { title: "Test Service Account" },
        },
      })

      await projectDatabase.terminal.create({
        data: {
          id: createId(),
          stateId: instanceState.id,
          name: "test-terminal",
          serviceAccountId: serviceAccount.id,
          meta: { title: "Test Terminal" },
          status: "active",
          spec: { image: "test:latest" },
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
        {
          clearTerminalData: true,
        },
      )

      // assert
      const terminals = await projectDatabase.terminal.findMany({
        where: { stateId: instanceState.id },
      })
      expect(terminals).toHaveLength(0)
    },
  )

  instanceStateTest(
    "marks terminals as unavailable when clearTerminalData=false",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      // create service account for terminal
      const serviceAccount = await projectDatabase.serviceAccount.create({
        data: {
          id: createId(),
          meta: { title: "Test Service Account" },
        },
      })

      const terminalId = createId()
      await projectDatabase.terminal.create({
        data: {
          id: terminalId,
          stateId: instanceState.id,
          name: "test-terminal",
          serviceAccountId: serviceAccount.id,
          meta: { title: "Test Terminal" },
          status: "active",
          spec: { image: "test:latest" },
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
        {
          clearTerminalData: false,
        },
      )

      // assert
      const terminal = await projectDatabase.terminal.findUnique({
        where: { id: terminalId },
      })
      expect(terminal?.status).toBe("unavailable")
    },
  )

  instanceStateTest(
    "deletes secrets when deleteSecrets=true",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      await projectDatabase.secret.create({
        data: {
          id: createId(),
          stateId: instanceState.id,
          name: "test-secret",
          meta: { title: "Test Secret" },
          content: "secret-value",
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
        {
          deleteSecrets: true,
        },
      )

      // assert
      const secrets = await projectDatabase.secret.findMany({
        where: { stateId: instanceState.id },
      })
      expect(secrets).toHaveLength(0)
    },
  )

  instanceStateTest(
    "keeps secrets when deleteSecrets=false",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      const secretId = createId()
      await projectDatabase.secret.create({
        data: {
          id: secretId,
          stateId: instanceState.id,
          name: "test-secret",
          meta: { title: "Test Secret" },
          content: "secret-value",
        },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
        {
          deleteSecrets: false,
        },
      )

      // assert
      const secret = await projectDatabase.secret.findUnique({
        where: { id: secretId },
      })
      expect(secret).toBeDefined()
      expect(secret?.stateId).toBe(instanceState.id)
    },
  )

  instanceStateTest(
    "recursively deletes child instances",
    async ({
      instanceStateService,
      projectDatabase,
      project,
      createInstanceState,
      projectService,
      pubsubManager,
      expect,
    }) => {
      // arrange
      const parentInstance = await createInstanceState(project.id, "composite.v1", "composite")
      const childInstance = await createInstanceState(project.id)

      // set both instances to deployed status and establish parent-child relationship
      await projectDatabase.instanceState.update({
        where: { id: parentInstance.id },
        data: { status: "deployed" },
      })

      await projectDatabase.instanceState.update({
        where: { id: childInstance.id },
        data: { parentId: parentInstance.id, status: "deployed" },
      })

      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        parentInstance.instanceId as InstanceId,
      )

      // assert
      const updatedParent = await projectDatabase.instanceState.findUnique({
        where: { id: parentInstance.id },
      })
      const updatedChild = await projectDatabase.instanceState.findUnique({
        where: { id: childInstance.id },
      })

      expect(updatedParent?.status).toBe("undeployed")
      expect(updatedChild?.status).toBe("undeployed")

      // verify both instances got state update events
      expect(pubsubManager.publish).toHaveBeenCalledTimes(2)
    },
  )

  instanceStateTest(
    "calls Pulumi deleteState for unit instances",
    async ({
      instanceStateService,
      project,
      createInstanceState,
      projectService,
      runnerBackend,
      expect,
    }) => {
      // arrange
      const instanceState = await createInstanceState(project.id, "server.v1", "unit")
      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act
      await instanceStateService.forgetInstanceState(
        project.id,
        instanceState.instanceId as InstanceId,
      )

      // assert
      const [instanceType, instanceName] = parseInstanceId(instanceState.instanceId as InstanceId)
      expect(runnerBackend.deleteState).toHaveBeenCalledWith({
        projectId: project.id,
        stateId: instanceState.id,
        libraryId: project.libraryId,
        instanceName,
        instanceType,
      })
    },
  )

  instanceStateTest(
    "throws error for missing instance",
    async ({ instanceStateService, project, projectService, expect }) => {
      // arrange
      const nonexistentInstanceId: InstanceId = "server.v1:nonexistent"
      projectService.getProjectOrThrow.mockResolvedValue(project)

      // act & assert
      await expect(
        instanceStateService.forgetInstanceState(project.id, nonexistentInstanceId),
      ).rejects.toThrow(InstanceStateNotFoundError)
    },
  )
})

describe("replaceCustomStatus", () => {
  instanceStateTest(
    "successfully replaces custom status",
    async ({ instanceStateService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)
      const serviceAccountId = createId()

      // create service account first
      await projectDatabase.serviceAccount.create({
        data: {
          id: serviceAccountId,
          meta: { title: "Test Service Account" },
        },
      })

      const status = {
        instanceId: instanceState.instanceId,
        name: "health",
        meta: { title: "Health Status" },
        value: "healthy",
        title: "Health Status",
        message: "Service is running normally",
        order: 10,
      }

      // act
      await instanceStateService.updateCustomStatus(
        project.id,
        instanceState.id,
        serviceAccountId,
        status,
      )

      // assert
      const customStatus = await projectDatabase.instanceCustomStatus.findUnique({
        where: {
          stateId_serviceAccountId_name: {
            stateId: instanceState.id,
            serviceAccountId,
            name: status.name,
          },
        },
      })

      expect(customStatus).toBeDefined()
      expect(customStatus?.value).toBe("healthy")
      expect(customStatus?.message).toBe("Service is running normally")
      expect(customStatus?.order).toBe(10)
    },
  )
})

describe("removeCustomStatus", () => {
  instanceStateTest(
    "successfully removes custom status",
    async ({ instanceStateService, projectDatabase, project, createInstanceState, expect }) => {
      // arrange
      const instanceState = await createInstanceState(project.id)

      // create service account first
      const serviceAccount = await projectDatabase.serviceAccount.create({
        data: {
          meta: { title: "Test Service Account" },
        },
      })

      await projectDatabase.instanceCustomStatus.create({
        data: {
          stateId: instanceState.id,
          serviceAccountId: serviceAccount.id,
          name: "health",
          meta: { title: "Health Status" },
          value: "healthy",
          order: 10,
        },
      })

      // act
      await instanceStateService.removeCustomStatus(
        project.id,
        instanceState.id,
        serviceAccount.id,
        "health",
      )

      // assert
      const customStatus = await projectDatabase.instanceCustomStatus.findUnique({
        where: {
          stateId_serviceAccountId_name: {
            stateId: instanceState.id,
            serviceAccountId: serviceAccount.id,
            name: "health",
          },
        },
      })

      expect(customStatus).toBeNull()
    },
  )
})
