import type { ProjectUnlockService } from "../business"
import type { ProjectLibraryService } from "../business/project-library"
import { afterEach, describe, vi } from "vitest"
import { OperationManager } from "./manager"
import { modelHash } from "./model-hash"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"
import { OperationContext } from "./operation-context"

afterEach(() => vi.restoreAllMocks())

describe("OperationManager reviewed context", () => {
  for (const overlayHash of [undefined, "local-hash"]) {
    operationTest(
      `pins a local-only catalog with overlay hash ${overlayHash ?? "null"} through execution`,
      async ({
        project,
        database,
        logger,
        runnerBackend,
        libraryBackend,
        artifactService,
        instanceLockService,
        operationService,
        secretService,
        instanceStateService,
        projectModelService,
        unitExtraService,
        entitySnapshotService,
        unitOutputService,
        libraryService,
        projectPortService,
        createContext,
        createMockLibrary,
        createOperation,
        setupPersistenceMocks,
        setupImmediateLocking,
        expect,
      }) => {
        await createContext({ instances: [], states: [] })
        setupPersistenceMocks({ instances: [] })
        setupImmediateLocking()
        const library = createMockLibrary()
        const catalog = { model: library, snapshotId: null, overlay: { hash: overlayHash } }

        const projectLibrary = {
          catalog: vi.fn().mockResolvedValue(catalog),
        } as unknown as ProjectLibraryService

        const projectUnlock = {
          registerUnlockTask: vi.fn(),
        } as unknown as ProjectUnlockService

        projectModelService.resolveProject = vi.fn().mockResolvedValue({
          instances: [],
          resolvedInputs: {},
        })

        libraryService.getLibraryModelCore.mockRejectedValue(new Error("Unpinned library read"))

        operationService.createOperation = vi
          .fn()
          .mockImplementation(async () =>
            createOperation({ type: "update", requestedInstanceIds: [], phases: [] }),
          )

        const load = vi.spyOn(OperationContext, "load")
        const operate = vi.spyOn(RuntimeOperation.prototype, "operateSafe")

        const manager = new OperationManager(
          runnerBackend,
          libraryBackend,
          artifactService,
          instanceLockService,
          projectUnlock,
          operationService,
          secretService,
          instanceStateService,
          projectModelService,
          unitExtraService,
          entitySnapshotService,
          unitOutputService,
          libraryService,
          projectPortService,
          database,
          logger,
          projectLibrary,
        )

        await manager.launch({
          projectId: project.id,
          type: "update",
          instanceIds: [],
          meta: { title: "Reviewed operation" },
        })

        await operate.mock.results[0].value

        expect(load).toHaveBeenCalledOnce()

        expect(load.mock.calls[0][6]).toEqual({
          library,
          snapshotId: null,
          projectLibrary,
          modelHash: modelHash({ instances: [], resolvedInputs: {} }),
          localOverlayHash: overlayHash ?? null,
        })

        const reviewedContext = await load.mock.results[0].value
        expect(reviewedContext.library).toBe(library)
        expect(reviewedContext.localOverlayHash).toBe(overlayHash ?? null)

        expect(operationService.markOperationFinished).toHaveBeenCalledWith(
          project.id,
          expect.any(String),
          "completed",
        )
      },
    )
  }
})
