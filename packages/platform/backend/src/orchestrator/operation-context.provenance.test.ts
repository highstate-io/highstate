import type { ProjectLibraryService } from "../business"
import { describe } from "vitest"
import { operationTest } from "./operation.test-utils"

describe("operation context evaluation provenance", () => {
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
