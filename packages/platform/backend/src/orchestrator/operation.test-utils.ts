import type { InstanceId, InstanceModel, VersionedName } from "@highstate/contract"
import type { ArtifactService } from "../artifact"
import type {
  EntitySnapshotService,
  InstanceLockService,
  InstanceStateService,
  OperationService,
  ProjectModelService,
  SecretService,
  UnitExtraService,
  UnitOutputService,
} from "../business"
import type { Operation } from "../database"
import type { LibraryBackend } from "../library"
import type {
  OperationType,
  RawPulumiOutputs,
  RunnerBackend,
  UnitDestroyOptions,
  UnitOptions,
  UnitStateUpdate,
  UnitUpdateOptions,
} from "../runner"
import type {
  InstanceOperationStatus,
  InstanceState,
  LibraryModel,
  OperationOptions,
  OperationPhase,
} from "../shared"
import { defineComponent, defineEntity, defineUnit, getInstanceId, z } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { type MockedObject, vi } from "vitest"
import { test } from "../test-utils"
import { OperationContext } from "./operation-context"

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

type AsyncQueue<T> = {
  push: (value: T) => void
  shift: () => Promise<T>
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const values: T[] = []
  const waiters: Array<(value: T) => void> = []

  const push = (value: T) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(value)
      return
    }

    values.push(value)
  }

  const shift = async (): Promise<T> => {
    const existing = values.shift()
    if (existing !== undefined) {
      return existing
    }

    const deferred = createDeferred<T>()
    waiters.push(deferred.resolve)
    return await deferred.promise
  }

  return { push, shift }
}

export type RunnerTestController = {
  setAutoCompletion: (enabled: boolean) => void

  setUpdateImpl: (impl: (options: UnitUpdateOptions) => Promise<void>) => void
  setPreviewImpl: (impl: (options: UnitUpdateOptions) => Promise<void>) => void
  setRefreshImpl: (impl: (options: UnitOptions) => Promise<void>) => void
  setDestroyImpl: (impl: (options: UnitDestroyOptions) => Promise<void>) => void

  emitProgress: (stateId: string, update: { current?: number; total?: number }) => void
  emitMessage: (stateId: string, message: string) => void
  emitError: (stateId: string, message: string) => void
  emitCompletion: (
    stateId: string,
    update?: {
      operationType?: OperationType
      rawOutputs?: RawPulumiOutputs | null
    },
  ) => void
}

export const operationTest = test.extend<{
  runnerBackend: MockedObject<RunnerBackend>
  runner: RunnerTestController
  libraryBackend: MockedObject<LibraryBackend>
  artifactService: MockedObject<ArtifactService>
  instanceLockService: MockedObject<InstanceLockService>
  operationService: MockedObject<OperationService>
  secretService: MockedObject<SecretService>
  instanceStateService: MockedObject<InstanceStateService>
  projectModelService: MockedObject<ProjectModelService>
  unitExtraService: MockedObject<UnitExtraService>
  entitySnapshotService: MockedObject<EntitySnapshotService>
  unitOutputService: MockedObject<UnitOutputService>

  createMockLibrary: () => LibraryModel
  createUnit: (name: string, type?: VersionedName) => InstanceModel
  createComposite: (name: string, type?: VersionedName) => InstanceModel
  createDeployedUnitState: (instance: InstanceModel) => InstanceState
  createOperation: (input: {
    type: Operation["type"]
    requestedInstanceIds: InstanceId[]
    phases: OperationPhase[]
    options?: Partial<OperationOptions>
  }) => Operation
  createContext: (input: {
    instances: InstanceModel[]
    states: InstanceState[]
    library?: LibraryModel
  }) => Promise<OperationContext>
  setupPersistenceMocks: (input: { instances: InstanceModel[] }) => void
  setupImmediateLocking: () => void
}>({
  runnerBackend: async ({}, use) => {
    let autoCompletionEnabled = true

    const lastOperationTypeByStateId = new Map<string, OperationType>()
    const updatesByStateId = new Map<string, AsyncQueue<UnitStateUpdate>>()

    const getQueue = (stateId: string): AsyncQueue<UnitStateUpdate> => {
      const existing = updatesByStateId.get(stateId)
      if (existing) {
        return existing
      }

      const created = createAsyncQueue<UnitStateUpdate>()
      updatesByStateId.set(stateId, created)
      return created
    }

    let updateImpl: (options: UnitUpdateOptions) => Promise<void> = async () => {}
    let previewImpl: (options: UnitUpdateOptions) => Promise<void> = async () => {}
    let refreshImpl: (options: UnitOptions) => Promise<void> = async () => {}
    let destroyImpl: (options: UnitDestroyOptions) => Promise<void> = async () => {}

    const runner: RunnerTestController = {
      setAutoCompletion: enabled => {
        autoCompletionEnabled = enabled
      },
      setUpdateImpl: impl => {
        updateImpl = impl
      },
      setPreviewImpl: impl => {
        previewImpl = impl
      },
      setRefreshImpl: impl => {
        refreshImpl = impl
      },
      setDestroyImpl: impl => {
        destroyImpl = impl
      },
      emitProgress: (stateId, update) => {
        getQueue(stateId).push({
          type: "progress",
          unitId: stateId as unknown as InstanceId,
          currentResourceCount: update.current,
          totalResourceCount: update.total,
        })
      },
      emitMessage: (stateId, message) => {
        getQueue(stateId).push({
          type: "message",
          unitId: stateId as unknown as InstanceId,
          message,
        })
      },
      emitError: (stateId, message) => {
        getQueue(stateId).push({
          type: "error",
          unitId: stateId as unknown as InstanceId,
          message,
        })
      },
      emitCompletion: (stateId, update = {}) => {
        const operationType =
          update.operationType ?? lastOperationTypeByStateId.get(stateId) ?? "update"

        const rawOutputs = update.rawOutputs ?? {
          // Note: tests generally don't care about actual Pulumi outputs.
          // Provide a non-empty object so business parsing can run if needed.
          $test: { value: true },
        }

        getQueue(stateId).push({
          type: "completion",
          unitId: stateId as unknown as InstanceId,
          operationType,
          rawOutputs,
        })
      },
    }

    const runnerBackend = vi.mockObject({
      update: vi.fn().mockImplementation(async (options: UnitUpdateOptions) => {
        lastOperationTypeByStateId.set(options.stateId, "update")
        await updateImpl(options)

        if (autoCompletionEnabled) {
          runner.emitCompletion(options.stateId, { operationType: "update" })
        }
      }),
      preview: vi.fn().mockImplementation(async (options: UnitUpdateOptions) => {
        lastOperationTypeByStateId.set(options.stateId, "update")
        await previewImpl(options)

        if (autoCompletionEnabled) {
          runner.emitCompletion(options.stateId, { operationType: "update" })
        }
      }),
      refresh: vi.fn().mockImplementation(async (options: UnitOptions) => {
        lastOperationTypeByStateId.set(options.stateId, "refresh")
        await refreshImpl(options)

        if (autoCompletionEnabled) {
          runner.emitCompletion(options.stateId, { operationType: "refresh" })
        }
      }),
      destroy: vi.fn().mockImplementation(async (options: UnitDestroyOptions) => {
        lastOperationTypeByStateId.set(options.stateId, "destroy")
        await destroyImpl(options)

        if (autoCompletionEnabled) {
          runner.emitCompletion(options.stateId, { operationType: "destroy" })
        }
      }),
      watch: vi.fn().mockImplementation((options: UnitOptions) => {
        const queue = getQueue(options.stateId)

        return (async function* () {
          while (true) {
            const update = await queue.shift()
            yield update

            if (update.type === "completion") {
              return
            }
          }
        })()
      }),
    } as unknown as RunnerBackend)

    Object.defineProperty(runnerBackend, "__testController", {
      value: runner,
      enumerable: false,
    })

    await use(runnerBackend)
  },

  runner: async ({ runnerBackend }, use) => {
    const controller = (runnerBackend as unknown as { __testController?: RunnerTestController })
      .__testController

    if (!controller) {
      throw new Error("runner test controller was not initialized")
    }

    await use(controller)
  },

  libraryBackend: async ({}, use) => {
    const libraryBackend = vi.mockObject({
      loadLibrary: vi.fn(),
      getResolvedUnitSources: vi.fn(),
    } as unknown as LibraryBackend)

    await use(libraryBackend)
  },

  artifactService: async ({}, use) => {
    const artifactService = vi.mockObject({
      getArtifactsByIds: vi.fn().mockResolvedValue([]),
    } as unknown as ArtifactService)

    await use(artifactService)
  },

  instanceLockService: async ({}, use) => {
    const instanceLockService = vi.mockObject({
      lockInstances: vi.fn(),
      unlockInstances: vi.fn().mockResolvedValue(undefined),
      unlockInstancesUnconditionally: vi.fn().mockResolvedValue(undefined),
      tryLockInstances: vi.fn(),
    } as unknown as InstanceLockService)

    await use(instanceLockService)
  },

  operationService: async ({}, use) => {
    const operationService = vi.mockObject({
      updateOperation: vi.fn().mockResolvedValue({} as Operation),
      markOperationFinished: vi.fn().mockResolvedValue({} as Operation),
      appendLog: vi.fn().mockResolvedValue({} as Operation),
    } as unknown as OperationService)

    await use(operationService)
  },

  secretService: async ({}, use) => {
    const secretService = vi.mockObject({
      getInstanceSecretValues: vi.fn().mockResolvedValue({}),
    } as unknown as SecretService)

    await use(secretService)
  },

  instanceStateService: async ({}, use) => {
    const instanceStateService = vi.mockObject({
      getInstanceStates: vi.fn(),
      createOperationStates: vi.fn(),
      updateOperationState: vi.fn(),
      updateOperationProgress: vi.fn(),
      publishGhostInstanceDeletion: vi.fn(),
    } as unknown as InstanceStateService)

    await use(instanceStateService)
  },

  projectModelService: async ({}, use) => {
    const projectModelService = vi.mockObject({
      getProjectModel: vi.fn(),
    } as unknown as ProjectModelService)

    await use(projectModelService)
  },

  unitExtraService: async ({}, use) => {
    const unitExtraService = vi.mockObject({
      getInstanceTriggers: vi.fn().mockResolvedValue([]),
      processUnitPages: vi.fn().mockResolvedValue([]),
      processUnitTerminals: vi.fn().mockResolvedValue([]),
      processUnitTriggers: vi.fn().mockResolvedValue([]),
      pruneInstanceArtifacts: vi.fn().mockResolvedValue(undefined),
    } as unknown as UnitExtraService)

    await use(unitExtraService)
  },

  unitOutputService: async ({}, use) => {
    const unitOutputService = vi.mockObject({
      parseUnitOutputs: vi.fn().mockResolvedValue({
        outputHash: null,
        statusFields: null,
        terminals: null,
        pages: null,
        triggers: null,
        secrets: null,
        workers: null,
        exportedArtifactIds: null,
        entitySnapshotPayload: null,
      }),
    } as unknown as UnitOutputService)

    await use(unitOutputService)
  },

  entitySnapshotService: async ({}, use) => {
    const entitySnapshotService = vi.mockObject({
      captureLatestSnapshotValues: vi.fn().mockResolvedValue(new Map()),
      persistUnitEntitySnapshots: vi.fn().mockResolvedValue(undefined),
    } as unknown as EntitySnapshotService)

    await use(entitySnapshotService)
  },

  createMockLibrary: async ({}, use) => {
    const createMockLibrary = (): LibraryModel => {
      const testEntity = defineEntity({
        type: "test.entity.v1",
        schema: z.object({
          value: z.string(),
        }),
      })

      const testUnit = defineUnit({
        type: "component.v1",
        inputs: {
          dependency: testEntity,
        },
        outputs: {
          value: testEntity,
        },
        source: {
          package: "@test/units",
          path: "test-unit",
        },
      })

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

    await use(createMockLibrary)
  },

  createUnit: async ({}, use) => {
    const createUnit = (name: string, type: VersionedName = "component.v1"): InstanceModel => {
      return {
        id: getInstanceId(type, name),
        name,
        type,
        kind: "unit",
        parentId: undefined,
        inputs: {},
        args: {},
        outputs: {},
      }
    }

    await use(createUnit)
  },

  createComposite: async ({}, use) => {
    const createComposite = (name: string, type: VersionedName = "composite.v1"): InstanceModel => {
      return {
        id: getInstanceId(type, name),
        name,
        type,
        kind: "composite",
        parentId: undefined,
        inputs: {},
        args: {},
        outputs: {},
      }
    }

    await use(createComposite)
  },

  createDeployedUnitState: async ({}, use) => {
    const createDeployedUnitState = (instance: InstanceModel): InstanceState => {
      return {
        id: instance.id,
        instanceId: instance.id,
        status: "deployed",
        source: "resident",
        kind: instance.kind,
        parentId: null,
        parentInstanceId: instance.parentId ?? null,
        selfHash: null,
        inputHash: 12345,
        outputHash: 12345,
        dependencyOutputHash: 0,
        statusFields: null,
        exportedArtifactIds: null,
        inputHashNonce: null,
        currentResourceCount: null,
        model: null,
        resolvedInputs: null,
        lastOperationState: {
          operationId: "test-op",
          stateId: instance.id,
          status: "updated" as InstanceOperationStatus,
          currentResourceCount: null,
          totalResourceCount: null,
          model: instance,
          resolvedInputs: {},
          startedAt: null,
          finishedAt: null,
        },
        evaluationState: {} as InstanceState["evaluationState"],
      }
    }

    await use(createDeployedUnitState)
  },

  createOperation: async ({}, use) => {
    const createOperation = (input: {
      type: Operation["type"]
      requestedInstanceIds: InstanceId[]
      phases: OperationPhase[]
      options?: Partial<OperationOptions>
    }): Operation => {
      return {
        id: createId(),
        meta: {
          title: "Test Operation",
          description: "Orchestrator runtime test",
        },
        type: input.type,
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
          ...input.options,
        },
        phases: input.phases,
        requestedInstanceIds: input.requestedInstanceIds,
        startedAt: new Date(),
        updatedAt: new Date(),
        finishedAt: null,
      }
    }

    await use(createOperation)
  },

  createContext: async (
    {
      project,
      logger,
      libraryBackend,
      instanceStateService,
      projectModelService,
      createMockLibrary,
    },
    use,
  ) => {
    const createContext = async (input: {
      instances: InstanceModel[]
      states: InstanceState[]
      library?: LibraryModel
    }): Promise<OperationContext> => {
      const library = input.library ?? createMockLibrary()

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

      projectModelService.getProjectModel.mockResolvedValue([
        {
          instances: input.instances,
          virtualInstances: [],
          hubs: [],
          ghostInstances: [],
        },
        project,
      ])

      instanceStateService.getInstanceStates.mockResolvedValue(input.states)

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

  setupPersistenceMocks: async ({ instanceStateService }, use) => {
    const setupPersistenceMocks = (input: { instances: InstanceModel[] }) => {
      const instanceByStateId = new Map<string, InstanceModel>(
        input.instances.map(instance => [instance.id, instance]),
      )

      instanceStateService.createOperationStates.mockImplementation(async (_projectId, tuples) => {
        return tuples.map(([opState, instancePatch]) => {
          return {
            instanceId: opState.model.id,
            ...instancePatch,
            lastOperationState: {
              operationId: opState.operationId,
              stateId: opState.stateId,
              status: opState.status,
              currentResourceCount: null,
              totalResourceCount: null,
              model: opState.model,
              resolvedInputs: opState.resolvedInputs,
              startedAt: null,
              finishedAt: null,
            },
          }
        })
      })

      instanceStateService.updateOperationState.mockImplementation(
        async (_projectId, stateId, operationId, options) => {
          const status =
            typeof options.operationState?.status === "string"
              ? options.operationState.status
              : "pending"

          const instance = instanceByStateId.get(stateId) ?? input.instances[0]
          if (!instance) {
            throw new Error("no instances provided to setupPersistenceMocks")
          }

          return {
            instanceId: instance.id,
            ...options.instanceState,
            lastOperationState: {
              operationId,
              stateId,
              status,
              currentResourceCount: null,
              totalResourceCount: null,
              model: instance,
              resolvedInputs: {},
              startedAt: null,
              finishedAt: null,
            },
          }
        },
      )
    }

    await use(setupPersistenceMocks)
  },

  setupImmediateLocking: async ({ instanceLockService }, use) => {
    const setupImmediateLocking = () => {
      instanceLockService.lockInstances.mockImplementation(
        async (_projectId, stateIds, _meta, action) => {
          await action?.(undefined as never, stateIds)
          return ["test", stateIds]
        },
      )
    }

    await use(setupImmediateLocking)
  },
})
