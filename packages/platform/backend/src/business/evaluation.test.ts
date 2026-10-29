import type { LibraryBackend, ProjectEvaluationResult } from "../library"
import type { PubSubManager } from "../pubsub"
import type { RuntimeEvaluationBackend } from "../runner"
import type { LibraryModel, ProjectModel } from "../shared"
import type { LibraryService } from "./library"
import type { ObjectRefIndexService } from "./object-ref-index"
import type { ProjectLibraryService } from "./project-library"
import type { ProjectModelService } from "./project-model"
import type { ProjectUnlockService } from "./project-unlock"
import { randomUUID } from "node:crypto"
import { defineComponent, defineUnit, getInstanceId, type InstanceModel } from "@highstate/contract"
import { clone } from "remeda"
import { describe, type MockedObject, vi } from "vitest"
import { modelRevision } from "../orchestrator/revisions"
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

const createCompositeInstance = (name: string): InstanceModel => ({
  ...createVirtualInstance(name),
  id: getInstanceId("composite.v1", name),
  type: "composite.v1",
  kind: "composite",
})

type ProjectModelEventPayload = {
  updatedGhostInstances?: InstanceModel[]
  deletedGhostInstanceIds?: string[]
}

describe("ProjectEvaluationSubsystem", () => {
  const evaluationTest = test.extend<{
    libraryBackend: MockedObject<LibraryBackend>
    libraryService: MockedObject<LibraryService>
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

    libraryService: async ({}, use) => {
      const service = vi.mockObject({
        getVirtualComponentsCore: vi.fn().mockResolvedValue({}),
      } as unknown as LibraryService)

      await use(service)
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
          containerRuntimeId: "runtime-id",
          pulumiStateBackendId: "pulumi-id",
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
        libraryService,
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
        libraryService,
        projectModelService,
        pubsubManager,
        projectUnlockService,
        vi.mockObject({
          track: vi.fn().mockResolvedValue(undefined),
        } as unknown as ObjectRefIndexService),
        logger,
      )

      await use(subsystem)
    },
  })

  const runtimeTest = evaluationTest.extend<{
    runtimeEvaluation: MockedObject<RuntimeEvaluationBackend>
    projectLibrary: MockedObject<ProjectLibraryService>
    snapshotIds: string[]
    runtimeSubsystem: ProjectEvaluationSubsystem
  }>({
    snapshotIds: async ({ projectDatabase }, use) => {
      const snapshots = await Promise.all(
        ["first", "second"].map(hash =>
          projectDatabase.librarySnapshot.create({
            data: {
              hash: `${hash}-${randomUUID()}`,
              lockfile: "{}",
              evaluatedModel: new Uint8Array(),
              sourceManifest: { packages: {}, owners: {} },
              compatibility: {
                runtimeProtocolVersion: 1,
                packageFormatVersion: 1,
                bunVersion: "1.3.13",
                pulumiVersion: "3.232.0",
              },
            },
          }),
        ),
      )

      const ids = snapshots.map(snapshot => snapshot.id)
      await use(ids)

      await projectDatabase.instanceEvaluationState.deleteMany({
        where: { librarySnapshotId: { in: ids } },
      })

      await projectDatabase.librarySnapshot.deleteMany({ where: { id: { in: ids } } })
    },
    runtimeEvaluation: async ({}, use) => {
      await use(vi.mockObject({ evaluate: vi.fn() } as unknown as RuntimeEvaluationBackend))
    },
    projectLibrary: async ({ snapshotIds }, use) => {
      const service = vi.mockObject({ catalog: vi.fn() } as unknown as ProjectLibraryService)

      service.catalog.mockResolvedValue({
        model: clone(libraryModel),
        sources: {},
        snapshotId: snapshotIds[0]!,
        overlay: { enabled: true, active: true, revision: "overlay-1", conflicts: [] },
      })

      await use(service)
    },
    runtimeSubsystem: async (
      {
        database,
        libraryBackend,
        libraryService,
        projectModelService,
        pubsubManager,
        projectUnlockService,
        logger,
        runtimeEvaluation,
        projectLibrary,
      },
      use,
    ) => {
      await use(
        new ProjectEvaluationSubsystem(
          database,
          libraryBackend,
          libraryService,
          projectModelService,
          pubsubManager,
          projectUnlockService,
          vi.mockObject({
            track: vi.fn().mockResolvedValue(undefined),
          } as unknown as ObjectRefIndexService),
          logger,
          runtimeEvaluation,
          projectLibrary,
        ),
      )
    },
  })

  runtimeTest(
    "persists actual runtime action and zero-output composite completion across subsystem restarts",
    async ({
      runtimeSubsystem,
      runtimeEvaluation,
      projectLibrary,
      snapshotIds,
      projectModelService,
      projectDatabase,
      project,
      database,
      libraryBackend,
      libraryService,
      pubsubManager,
      publishEvents,
      projectUnlockService,
      logger,
      expect,
    }) => {
      const root = createCompositeInstance("empty-root")

      const resolved = {
        project,
        library: clone(libraryModel),
        instances: [root],
        stateMap: new Map(),
        resolvedInputs: {},
      }

      projectModelService.resolveProject.mockResolvedValue(resolved)

      runtimeEvaluation.evaluate.mockResolvedValueOnce({
        actionId: "action-first",
        result: { success: true, virtualInstances: [], topLevelErrors: {} },
      })

      const restarted = new ProjectEvaluationSubsystem(
        database,
        libraryBackend,
        libraryService,
        projectModelService,
        pubsubManager,
        projectUnlockService,
        vi.mockObject({
          track: vi.fn().mockResolvedValue(undefined),
        } as unknown as ObjectRefIndexService),
        logger,
        runtimeEvaluation,
        projectLibrary,
      )

      await runtimeSubsystem.evaluateProject(project.id)

      const state = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: root.id },
        include: { evaluationState: true },
      })

      expect(state.source).toBe("resident")
      expect(state.kind).toBe("composite")
      expect(publishEvents.filter(event => event.key[0] === "project-model")).toHaveLength(0)

      expect(state.evaluationState).toMatchObject({
        status: "evaluated",
        model: null,
        librarySnapshotId: snapshotIds[0],
        modelRevision: modelRevision({ instances: [root], resolvedInputs: {} }),
        localOverlayRevision: "overlay-1",
        evaluationActionId: "action-first",
      })

      expect(runtimeEvaluation.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: project.id,
          librarySnapshotId: snapshotIds[0],
          instances: [root],
          resolvedInputs: {},
          virtualComponents: {},
        }),
        expect.any(AbortSignal),
      )

      // the persisted marker, rather than process memory, identifies the completed empty expansion
      const catalog = await projectLibrary.catalog(project.id)
      expect(state.evaluationState?.librarySnapshotId).toBe(catalog.snapshotId)

      runtimeEvaluation.evaluate.mockResolvedValueOnce({
        actionId: "action-second",
        result: { success: true, virtualInstances: [], topLevelErrors: {} },
      })

      await restarted.evaluateProject(project.id)

      const repeated = await projectDatabase.instanceEvaluationState.findUniqueOrThrow({
        where: { stateId: state.id },
      })

      expect(repeated.evaluationActionId).toBe("action-second")
    },
  )

  for (const changed of ["model", "snapshot", "overlay"] as const) {
    runtimeTest(
      `discards stale ${changed} output and evaluates the current revision`,
      async ({
        runtimeSubsystem,
        runtimeEvaluation,
        projectLibrary,
        snapshotIds,
        projectModelService,
        projectDatabase,
        publishEvents,
        project,
        expect,
      }) => {
        const root = createCompositeInstance("changing-root")
        const obsolete = createVirtualInstance("obsolete")
        const current = createVirtualInstance("current")

        const resolved = {
          project,
          library: clone(libraryModel),
          instances: [root],
          stateMap: new Map(),
          resolvedInputs: {},
        }

        projectModelService.resolveProject.mockResolvedValue(resolved)

        runtimeEvaluation.evaluate.mockImplementationOnce(async () => {
          if (changed === "model") {
            projectModelService.resolveProject.mockResolvedValue({
              ...resolved,
              instances: [{ ...root, args: { changed: true } }],
            })
          } else {
            const catalog = await projectLibrary.catalog(project.id)

            projectLibrary.catalog.mockResolvedValue({
              ...catalog,
              snapshotId: changed === "snapshot" ? snapshotIds[1]! : catalog.snapshotId,
              overlay: {
                ...catalog.overlay,
                revision: changed === "overlay" ? "overlay-2" : catalog.overlay.revision,
              },
            })
          }

          return {
            actionId: "obsolete-action",
            result: { success: true, virtualInstances: [obsolete], topLevelErrors: {} },
          }
        })

        runtimeEvaluation.evaluate.mockResolvedValueOnce({
          actionId: "current-action",
          result: { success: true, virtualInstances: [current], topLevelErrors: {} },
        })

        await runtimeSubsystem.evaluateProject(project.id)

        expect(runtimeEvaluation.evaluate).toHaveBeenCalledTimes(2)

        expect(
          await projectDatabase.instanceState.findUnique({ where: { instanceId: obsolete.id } }),
        ).toBeNull()

        const persisted = await projectDatabase.instanceEvaluationState.findMany()
        expect(persisted).toHaveLength(2)
        expect(persisted.every(state => state.evaluationActionId === "current-action")).toBe(true)
        expect(JSON.stringify(publishEvents)).not.toContain(obsolete.id)
      },
    )
  }

  for (const fence of ["transaction", "publication"] as const) {
    runtimeTest(
      `rejects revision changes at the ${fence} fence before publishing`,
      async ({
        runtimeSubsystem,
        runtimeEvaluation,
        projectLibrary,
        projectModelService,
        projectDatabase,
        publishEvents,
        project,
        expect,
      }) => {
        const root = createCompositeInstance("transaction-root")
        const obsolete = createVirtualInstance("transaction-obsolete")
        const current = createVirtualInstance("transaction-current")

        projectModelService.resolveProject.mockResolvedValue({
          project,
          library: clone(libraryModel),
          instances: [root],
          stateMap: new Map(),
          resolvedInputs: {},
        })

        const catalog = await projectLibrary.catalog(project.id)
        // the sixth read fences transaction completion; the seventh fences publication
        let catalogReads = 0

        projectLibrary.catalog.mockImplementation(async () => {
          catalogReads += 1
          return catalogReads < (fence === "transaction" ? 6 : 7)
            ? catalog
            : { ...catalog, overlay: { ...catalog.overlay, revision: "overlay-2" } }
        })

        runtimeEvaluation.evaluate.mockResolvedValueOnce({
          actionId: "obsolete-action",
          result: { success: true, virtualInstances: [obsolete], topLevelErrors: {} },
        })

        runtimeEvaluation.evaluate.mockResolvedValueOnce({
          actionId: "current-action",
          result: { success: true, virtualInstances: [current], topLevelErrors: {} },
        })

        await runtimeSubsystem.evaluateProject(project.id)
        expect(runtimeEvaluation.evaluate).toHaveBeenCalledTimes(2)

        expect(
          await projectDatabase.instanceEvaluationState.findFirst({
            where: { state: { instanceId: obsolete.id } },
          }),
        ).toBeNull()

        const updates = publishEvents
          .filter(event => event.key[0] === "project-model")
          .flatMap(
            event =>
              (event.payload as { updatedVirtualInstances?: InstanceModel[] })
                .updatedVirtualInstances ?? [],
          )

        expect(updates.map(instance => instance.id)).not.toContain(obsolete.id)
      },
    )
  }

  runtimeTest(
    "does not fall back to host evaluation before a runtime action exists",
    async ({
      runtimeSubsystem,
      runtimeEvaluation,
      libraryBackend,
      projectModelService,
      projectDatabase,
      project,
      expect,
    }) => {
      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [createCompositeInstance("unplaced")],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      runtimeEvaluation.evaluate.mockRejectedValue(new Error("Image unavailable"))

      await expect(runtimeSubsystem.evaluateProject(project.id)).rejects.toThrow(
        "Image unavailable",
      )

      expect(libraryBackend.evaluateCompositeInstances).not.toHaveBeenCalled()
      expect(await projectDatabase.instanceEvaluationState.count()).toBe(0)
    },
  )

  runtimeTest(
    "persists runtime failure with the allocated action identity",
    async ({
      runtimeSubsystem,
      runtimeEvaluation,
      projectModelService,
      projectDatabase,
      project,
      expect,
    }) => {
      const root = createCompositeInstance("failed-action")

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [root],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      runtimeEvaluation.evaluate.mockRejectedValue(
        Object.assign(new Error("Agent disconnected"), { actionId: "failed-runtime-action" }),
      )

      await runtimeSubsystem.evaluateProject(project.id)
      const persisted = await projectDatabase.instanceEvaluationState.findFirstOrThrow()

      expect(persisted).toMatchObject({
        status: "error",
        evaluationActionId: "failed-runtime-action",
      })
    },
  )

  runtimeTest(
    "keeps evaluated resident wiring without turning the composite into a virtual child",
    async ({
      runtimeSubsystem,
      runtimeEvaluation,
      projectModelService,
      projectDatabase,
      project,
      expect,
    }) => {
      const root = createCompositeInstance("wired-root")
      const evaluatedRoot = { ...root, outputs: { value: [] } }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [root],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      runtimeEvaluation.evaluate.mockResolvedValue({
        actionId: "wired-action",
        result: { success: true, virtualInstances: [evaluatedRoot], topLevelErrors: {} },
      })

      await runtimeSubsystem.evaluateProject(project.id)

      const persisted = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: root.id },
        include: { evaluationState: true },
      })

      expect(persisted.source).toBe("resident")
      expect(persisted.evaluationState?.model).toEqual(evaluatedRoot)
    },
  )

  runtimeTest(
    "rejects duplicate virtual IDs without replacing the previous virtual evaluation",
    async ({
      runtimeSubsystem,
      runtimeEvaluation,
      projectModelService,
      projectDatabase,
      project,
      expect,
    }) => {
      const root = createCompositeInstance("duplicate-root")
      const child = createVirtualInstance("duplicate-child")

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [root],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      runtimeEvaluation.evaluate.mockResolvedValueOnce({
        actionId: "valid-action",
        result: { success: true, virtualInstances: [child], topLevelErrors: {} },
      })

      await runtimeSubsystem.evaluateProject(project.id)

      runtimeEvaluation.evaluate.mockResolvedValueOnce({
        actionId: "duplicate-action",
        result: { success: true, virtualInstances: [child, child], topLevelErrors: {} },
      })

      await runtimeSubsystem.evaluateProject(project.id)

      const persisted = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: child.id },
        include: { evaluationState: true },
      })

      expect(persisted.evaluationState).toMatchObject({
        status: "evaluated",
        evaluationActionId: "valid-action",
      })

      const composite = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: root.id },
        include: { evaluationState: true },
      })

      expect(composite.evaluationState).toMatchObject({
        status: "error",
        evaluationActionId: "duplicate-action",
      })
    },
  )

  const getLastProjectEvent = (
    events: Array<{ key: readonly string[]; payload: unknown }>,
  ): ProjectModelEventPayload | undefined => {
    return events.filter(event => event.key[0] === "project-model").at(-1)?.payload as
      | ProjectModelEventPayload
      | undefined
  }

  evaluationTest(
    "passes project virtual components to library evaluation",
    async ({ subsystem, project, projectModelService, libraryBackend, libraryService, expect }) => {
      const virtualComponents = {
        "system.import.state-1.v1": libraryModel.components["component.v1"]!,
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      libraryService.getVirtualComponentsCore.mockResolvedValue(virtualComponents)

      libraryBackend.evaluateCompositeInstances.mockResolvedValue({
        success: true,
        virtualInstances: [],
        topLevelErrors: {},
      })

      await subsystem.evaluateProject(project.id)

      expect(libraryBackend.evaluateCompositeInstances).toHaveBeenCalledWith(
        "local",
        virtualComponents,
        [],
        {},
      )
    },
  )

  evaluationTest(
    "does not promote existing virtual instances to ghosts when evaluation fails",
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
      const virtualInstance = createVirtualInstance("ghost-on-failure")
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
          modelRevision: "previous",
          evaluationActionId: "previous",
          status: "evaluated",
          message: "ok",
          model: storedModel,
        },
      })

      const compositeInstance: InstanceModel = {
        id: getInstanceId("composite.v1", "root"),
        kind: "composite",
        type: "composite.v1",
        name: "root",
        args: {},
        inputs: {},
        hubInputs: {},
        injectionInputs: [],
        resolvedInputs: {},
        outputs: {},
        resolvedOutputs: {},
      }

      const evaluationResult: ProjectEvaluationResult = {
        success: false,
        error: "failed to evaluate",
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [compositeInstance],
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

      const persisted = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: virtualInstance.id },
        include: { evaluationState: true },
      })

      expect(persisted.evaluationState?.status).toBe("evaluated")
      expect(persisted.evaluationState?.message).toBe("ok")

      await projectDatabase.instanceEvaluationState.deleteMany({
        where: {
          state: {
            instanceId: virtualInstance.id,
          },
        },
      })

      await projectDatabase.instanceState.deleteMany({
        where: {
          instanceId: virtualInstance.id,
        },
      })
    },
  )

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
          modelRevision: "previous",
          evaluationActionId: "previous",
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
        instances: [],
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
        instances: [],
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
        instances: [],
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

  evaluationTest(
    "deduplicates evaluation states and prioritizes errors",
    async ({
      subsystem,
      project,
      projectDatabase,
      projectModelService,
      libraryBackend,
      expect,
    }) => {
      // arrange
      const virtualInstance = createVirtualInstance("overlap")

      const evaluationResult: ProjectEvaluationResult = {
        success: true,
        virtualInstances: [virtualInstance],
        topLevelErrors: {
          [virtualInstance.id]: "failed to evaluate subtree",
        },
      }

      projectModelService.resolveProject.mockResolvedValue({
        project,
        library: clone(libraryModel),
        instances: [
          {
            ...virtualInstance,
            kind: "composite",
            type: "composite.v1",
          },
        ],
        stateMap: new Map(),
        resolvedInputs: {},
      })

      libraryBackend.evaluateCompositeInstances.mockResolvedValue(evaluationResult)

      // act
      await subsystem.evaluateProject(project.id)

      // assert
      const state = await projectDatabase.instanceState.findUniqueOrThrow({
        where: { instanceId: virtualInstance.id },
        include: { evaluationState: true },
      })

      expect(state.evaluationState).toBeDefined()
      expect(state.evaluationState?.status).toBe("error")
      expect(state.evaluationState?.message).toBe("failed to evaluate subtree")
    },
  )
})
