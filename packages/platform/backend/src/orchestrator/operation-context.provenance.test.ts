import type { ProjectLibraryService } from "../business"
import type { ProjectLibrarySnapshot } from "../library"
import { describe, vi } from "vitest"
import { operationTest } from "./operation.test-utils"
import { createOperationPlan } from "./operation-plan"

describe("operation context evaluation provenance", () => {
  operationTest(
    "includes a deployed ghost child in destroy after its package is removed",
    async ({
      createComposite,
      createUnit,
      createDeployedUnitState,
      createContext,
      createMockLibrary,
      expect,
    }) => {
      const parent = createComposite("removed")
      const child = createUnit("historical-child")
      child.parentId = parent.id

      const states = [parent, child].map(instance => {
        const state = createDeployedUnitState(instance)
        state.model = instance
        state.librarySnapshotId = "deployed-snapshot"
        state.libraryPackageVersionId = "deployed-package"
        return state
      })

      const historicalLibrary = createMockLibrary()
      const library = { components: {}, entities: {} }

      const projectLibrary = {
        historicalSnapshot: vi.fn(
          async (_projectId: string, snapshotId: string) =>
            (snapshotId === "empty-snapshot"
              ? { model: library, packages: [], sourceManifest: { owners: {} } }
              : {
                  model: historicalLibrary,
                  packages: [
                    { id: "deployed-package", packageName: "@test/library", version: "1.0.0" },
                  ],
                  sourceManifest: {
                    owners: {
                      [`components:${parent.type}`]: "@test/library",
                      [`components:${child.type}`]: "@test/library",
                    },
                  },
                }) as unknown as ProjectLibrarySnapshot,
        ),
        getSnapshotUnitSources: vi.fn(async () => []),
      } as unknown as ProjectLibraryService

      const context = await createContext({
        instances: [parent],
        ghostInstances: [child],
        states,
        library,
        pinned: { library, snapshotId: "empty-snapshot", projectLibrary },
      })

      const plan = createOperationPlan(context, "destroy", [parent.id], {})

      expect(plan.flatMap(phase => phase.instances.map(instance => instance.id))).toEqual(
        expect.arrayContaining([parent.id, child.id]),
      )

      expect(context.getExecutionLibrary(child.id, "destroy")).toEqual(historicalLibrary)

      expect(context.getExecutionProvenance(child.id, "destroy")?.librarySnapshotId).toBe(
        "deployed-snapshot",
      )
    },
  )

  operationTest(
    "rejects missing resident composite completion markers even without a desired snapshot",
    async ({ createComposite, createContext, createMockLibrary, expect }) => {
      const composite = createComposite("empty")
      const library = createMockLibrary()

      await expect(
        createContext({
          instances: [composite],
          states: [],
          library,
          pinned: {
            library,
            snapshotId: null,
            modelRevision: "resident-revision",
            localOverlayRevision: null,
            projectLibrary: {} as ProjectLibraryService,
          },
        }),
      ).rejects.toThrow("Composite evaluation is stale")
    },
  )

  operationTest(
    "accepts an empty graph without execution outputs",
    async ({ createContext, createMockLibrary, expect }) => {
      const library = createMockLibrary()

      const context = await createContext({
        instances: [],
        states: [],
        library,
        pinned: {
          library,
          snapshotId: null,
          modelRevision: "empty-revision",
          localOverlayRevision: null,
          projectLibrary: {} as ProjectLibraryService,
        },
      })

      expect([...context.getInstanceIds()]).toEqual([])
    },
  )

  operationTest(
    "rejects resident completion markers stamped for a previous overlay",
    async ({
      createComposite,
      createDeployedUnitState,
      createContext,
      createMockLibrary,
      expect,
    }) => {
      const composite = createComposite("empty")
      const state = createDeployedUnitState(composite)

      state.evaluationState = {
        librarySnapshotId: null,
        modelRevision: "revision",
        localOverlayRevision: "previous-overlay",
        evaluationActionId: "action",
      } as typeof state.evaluationState

      const library = createMockLibrary()

      await expect(
        createContext({
          instances: [composite],
          states: [state],
          library,
          pinned: {
            library,
            snapshotId: null,
            modelRevision: "revision",
            localOverlayRevision: "current-overlay",
            projectLibrary: {} as ProjectLibraryService,
          },
        }),
      ).rejects.toThrow("Composite evaluation is stale")
    },
  )
})
