import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { InstanceLockService, InstanceStateService, ProjectModelService } from "../business"
import type { Operation } from "../database"
import type { LibraryBackend } from "../library"
import type { InstanceState, LibraryModel, OperationOptions } from "../shared"
import type { PlanTestBuilder } from "./plan-test-builder"
import { defineComponent, defineEntity, defineUnit, z } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { OperationContext } from "./operation-context"

export const operationPlanTest = test.extend<{
  // mock services
  libraryBackend: MockedObject<LibraryBackend>
  instanceLockService: MockedObject<InstanceLockService>
  instanceStateService: MockedObject<InstanceStateService>
  projectModelService: MockedObject<ProjectModelService>

  createTestOperation: (
    type?: "update" | "destroy" | "recreate" | "preview" | "refresh",
    instanceIds?: InstanceId[],
    options?: Partial<OperationOptions>,
  ) => Operation
  createMockLibrary: (componentTypes?: string[]) => LibraryModel

  // context management
  createContext: (instances: InstanceModel[], states?: InstanceState[]) => Promise<OperationContext>

  // plan test builder
  testBuilder: () => PlanTestBuilder
}>({
  // mock services setup
  libraryBackend: async ({}, use) => {
    const mock = vi.mocked({
      loadLibrary: vi.fn(),
      getResolvedUnitSources: vi.fn(),
    } as unknown as LibraryBackend)

    await use(mock)
  },

  instanceLockService: async ({}, use) => {
    const mock = vi.mocked({
      lockInstances: vi.fn(),
      tryLockInstances: vi.fn(),
      unlockInstancesUnconditionally: vi.fn(),
    } as unknown as InstanceLockService)

    await use(mock)
  },

  instanceStateService: async ({}, use) => {
    const mock = vi.mocked({
      getInstanceStates: vi.fn(),
      updateOperationState: vi.fn(),
      updateOperationProgress: vi.fn(),
      forgetInstanceState: vi.fn(),
    } as unknown as InstanceStateService)

    await use(mock)
  },

  projectModelService: async ({}, use) => {
    const mock = vi.mocked({
      getProjectModel: vi.fn(),
    } as unknown as ProjectModelService)

    await use(mock)
  },

  createTestOperation: async ({}, use) => {
    const createOperation = (
      type: "update" | "destroy" | "recreate" | "preview" | "refresh" = "update",
      instanceIds: InstanceId[] = [],
      options: Partial<OperationOptions> = {},
    ): Operation => ({
      id: createId(),
      meta: {
        title: "Test Operation",
        description: "Test operation for workset tests",
      },
      type,
      status: "pending",
      options: {
        forceUpdateDependencies: false,
        ignoreDependencies: false,
        forceUpdateChildren: false,
        destroyDependentInstances: true,
        invokeDestroyTriggers: true,
        deleteUnreachableResources: false,
        forceDeleteState: false,
        allowPartialCompositeInstanceUpdate: false,
        allowPartialCompositeInstanceDestruction: false,
        refresh: false,
        ...options,
      },
      phases: [],
      requestedInstanceIds: instanceIds,
      startedAt: new Date(),
      updatedAt: new Date(),
      finishedAt: null,
    })

    await use(createOperation)
  },

  createMockLibrary: async ({}, use) => {
    const createLibrary = (): LibraryModel => {
      // create test entity for dependencies
      const testEntity = defineEntity({
        type: "test.entity.v1",
        schema: z.object({
          value: z.string(),
        }),
      })

      // create test unit with dependency input
      const testUnit = defineUnit({
        type: "component.v1",
        inputs: {
          dependency: testEntity,
        },
        source: {
          package: "@test/units",
          path: "test-unit",
        },
      })

      // create composite (not unit)
      const testComposite = defineComponent({
        type: "composite.v1",
        create: () => {},
      })

      return {
        components: {
          "component.v1": testUnit.model,
          "composite.v1": testComposite.model,
        },
        entities: {
          "test.entity.v1": testEntity.model,
        },
      }
    }

    await use(createLibrary)
  },

  createContext: async (
    {
      project,
      libraryBackend,
      instanceStateService,
      projectModelService,
      logger,
      createMockLibrary,
    },
    use,
  ) => {
    const createContext = async (
      instances: InstanceModel[],
      states: InstanceState[] = [],
    ): Promise<OperationContext> => {
      const library = createMockLibrary()

      // setup mocks
      projectModelService.getProjectModel.mockResolvedValue([
        {
          instances,
          virtualInstances: [],
          hubs: [],
          ghostInstances: [],
        },
        project,
      ])
      libraryBackend.loadLibrary.mockResolvedValue(library)
      libraryBackend.getResolvedUnitSources.mockResolvedValue([
        {
          unitType: "component.v1",
          sourceHash: 12345,
          projectPath: "test",
          allowedDependencies: [],
        },
        {
          unitType: "composite.v1",
          sourceHash: 12345,
          projectPath: "test",
          allowedDependencies: [],
        },
      ])
      instanceStateService.getInstanceStates.mockResolvedValue(states)

      // create context
      return await OperationContext.load(
        project.id,
        libraryBackend,
        instanceStateService,
        projectModelService,
        undefined,
        undefined,
        logger,
      )
    }

    await use(createContext)
  },

  // plan test builder
  testBuilder: async ({ createContext, createTestOperation }, use) => {
    const { PlanTestBuilder } = await import("./plan-test-builder")
    const createPlanBuilder = () => new PlanTestBuilder(createContext, createTestOperation)

    await use(createPlanBuilder)
  },
})
