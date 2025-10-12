import type { LibraryBackend, ProjectEvaluationResult } from "../library"
import type { PubSubManager } from "../pubsub"
import type { LibraryModel, ProjectModel } from "../shared"
import type { ProjectModelService } from "./project-model"
import type { ProjectUnlockService } from "./project-unlock"
import { defineComponent, defineUnit, getInstanceId, type InstanceModel } from "@highstate/contract"
import { clone } from "remeda"
import { describe, type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { ProjectEvaluationSubsystem } from "./evaluation"

const libraryModel: LibraryModel = {
  components: {
    "component.v1": defineUnit({
      type: "component.v1",
      inputs: {},
      source: { package: "@highstate/local", path: "component" },
    }).model,
    "composite.v1": defineComponent({
      type: "composite.v1",
      create: () => {},
    }).model,
  },
  entities: {},
}

const createProjectModel = (): ProjectModel => ({
  instances: [],
  hubs: [],
})

const createFullProjectModel = () => ({
  ...createProjectModel(),
  virtualInstances: [],
  ghostInstances: [],
})

const createVirtualInstance = (name: string): InstanceModel => ({
  id: getInstanceId("component.v1", name),
  kind: "unit",
  type: "component.v1",
  name,
  args: {},
  inputs: {},
  hubInputs: {},
  injectionInputs: [],
  resolvedInputs: {},
  outputs: {},
  resolvedOutputs: {},
})

type ProjectModelEventPayload = {
  updatedGhostInstances?: InstanceModel[]
  deletedGhostInstanceIds?: string[]
}

describe("ProjectEvaluationSubsystem", () => {
  const evaluationTest = test.extend<{
    libraryBackend: MockedObject<LibraryBackend>
    projectModelService: MockedObject<ProjectModelService>
    projectUnlockService: MockedObject<ProjectUnlockService>
    pubsubManager: MockedObject<PubSubManager>
    publishEvents: Array<{ key: readonly string[]; payload: unknown }>
    subsystem: ProjectEvaluationSubsystem
  }>({
    libraryBackend: async ({}, use) => {
      const backend = vi.mockObject({
        evaluateCompositeInstances: vi.fn(),
        loadLibrary: vi.fn(),
        getResolvedUnitSources: vi.fn(),
        watchLibrary: vi.fn(),
      } as unknown as LibraryBackend)

      backend.loadLibrary.mockResolvedValue(clone(libraryModel))
      backend.getResolvedUnitSources.mockResolvedValue([])

      await use(backend)
    },

    projectModelService: async ({}, use) => {
      const service = vi.mockObject({
        resolveProject: vi.fn(),
        getProjectModel: vi.fn(),
      } as unknown as ProjectModelService)

      service.getProjectModel.mockResolvedValue([
        createFullProjectModel(),
        {
          id: "project-id",
          name: "project",
          meta: { title: "Project" },
          spaceId: "space-id",
          modelStorageId: "model-storage",
          libraryId: "library-id",
          pulumiBackendId: "pulumi-id",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      await use(service)
    },

    projectUnlockService: async ({}, use) => {
      const unlockService = vi.mockObject({
        registerUnlockTask: vi.fn(),
      } as unknown as ProjectUnlockService)

      await use(unlockService)
    },

    publishEvents: async ({}, use) => {
      const events: Array<{ key: readonly string[]; payload: unknown }> = []
      await use(events)
    },

    pubsubManager: async ({ publishEvents }, use) => {
      const manager = vi.mockObject({
        publish: vi.fn(async (key: readonly string[], payload: unknown) => {
          publishEvents.push({ key, payload })
        }),
      } as unknown as PubSubManager)

      await use(manager)
    },

    subsystem: async (
      {
        database,
        libraryBackend,
        projectModelService,
        pubsubManager,
        projectUnlockService,
        logger,
      },
      use,
    ) => {
      const subsystem = new ProjectEvaluationSubsystem(
        database,
        libraryBackend,
        projectModelService,
        pubsubManager,
        projectUnlockService,
        logger,
      )

      await use(subsystem)
    },
  })

  const getLastProjectEvent = (
    events: Array<{ key: readonly string[]; payload: unknown }>,
  ): ProjectModelEventPayload | undefined => {
    return events.filter(event => event.key[0] === "project-model").at(-1)?.payload as
      | ProjectModelEventPayload
      | undefined
  }

  evaluationTest(
    "publishes ghost creation when evaluation output is missing",
    async ({
      subsystem,
      publishEvents,
      project,
      projectDatabase,
      projectModelService,
      libraryBackend,
      expect,
    }) => {
      // arrange
      const virtualInstance = createVirtualInstance("ghost")
      const storedModel = clone(virtualInstance)

      const state = await projectDatabase.instanceState.create({
        data: {
          instanceId: virtualInstance.id,
          kind: "unit",
          source: "virtual",
          status: "deployed",
          model: storedModel,
        },
      })

      await projectDatabase.instanceEvaluationState.create({
        data: {
          stateId: state.id,
          status: "evaluated",
          message: "ok",
          model: storedModel,
        },
      })

      const evaluationResult: ProjectEvaluationResult = {
        success: true,
        virtualInstances: [],
        topLevelErrors: {},
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [virtualInstance],
        stateMap: new Map(),
        resolvedInputs: {},
      })
      libraryBackend.evaluateCompositeInstances.mockResolvedValue(evaluationResult)

      // act
      publishEvents.length = 0
      await subsystem.evaluateProject(project.id)

      // assert
      const payload = getLastProjectEvent(publishEvents)
      expect(payload?.updatedGhostInstances).toEqual([storedModel])
      expect(payload?.deletedGhostInstanceIds ?? []).toHaveLength(0)
    },
  )

  evaluationTest(
    "ignores undeployed virtual instances when evaluation output is missing",
    async ({
      subsystem,
      publishEvents,
      project,
      projectDatabase,
      projectModelService,
      libraryBackend,
      expect,
    }) => {
      // arrange
      const virtualInstance = createVirtualInstance("ghost-undeployed")
      const storedModel = clone(virtualInstance)

      await projectDatabase.instanceState.create({
        data: {
          instanceId: virtualInstance.id,
          kind: "unit",
          source: "virtual",
          status: "undeployed",
          model: storedModel,
        },
      })

      const evaluationResult: ProjectEvaluationResult = {
        success: true,
        virtualInstances: [],
        topLevelErrors: {},
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [virtualInstance],
        stateMap: new Map(),
        resolvedInputs: {},
      })
      libraryBackend.evaluateCompositeInstances.mockResolvedValue(evaluationResult)

      // act
      publishEvents.length = 0
      await subsystem.evaluateProject(project.id)

      // assert
      const payload = getLastProjectEvent(publishEvents)
      expect(payload?.updatedGhostInstances ?? []).toHaveLength(0)
      expect(payload?.deletedGhostInstanceIds ?? []).toHaveLength(0)
    },
  )

  evaluationTest(
    "publishes ghost resolution when evaluation output returns",
    async ({
      subsystem,
      publishEvents,
      project,
      projectDatabase,
      projectModelService,
      libraryBackend,
      expect,
    }) => {
      // arrange
      const virtualInstance = createVirtualInstance("ghost-restored")
      const storedModel = clone(virtualInstance)

      await projectDatabase.instanceState.create({
        data: {
          instanceId: virtualInstance.id,
          kind: "unit",
          source: "virtual",
          status: "deployed",
          model: storedModel,
        },
      })

      const evaluationResult: ProjectEvaluationResult = {
        success: true,
        virtualInstances: [virtualInstance],
        topLevelErrors: {},
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [virtualInstance],
        stateMap: new Map(),
        resolvedInputs: {},
      })
      libraryBackend.evaluateCompositeInstances.mockResolvedValue(evaluationResult)

      // act
      publishEvents.length = 0
      await subsystem.evaluateProject(project.id)

      // assert
      const payload = getLastProjectEvent(publishEvents)
      expect(payload?.updatedGhostInstances ?? []).toHaveLength(0)
      expect(payload?.deletedGhostInstanceIds).toEqual([virtualInstance.id])
    },
  )
})
