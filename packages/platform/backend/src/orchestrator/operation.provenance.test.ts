import type { ProjectLibraryService } from "../business"
import type { ProjectLibrarySnapshot } from "../library"
import { describe, vi } from "vitest"
import { RuntimeOperation } from "./operation"
import { createDeferred, operationTest } from "./operation.test-utils"
import { createOperationPlan } from "./operation-plan"

const provenanceTest = operationTest.extend<{
  scenario: {
    runtime: (type: "update" | "recreate" | "refresh" | "preview") => RuntimeOperation
    context: import("./operation-context").OperationContext
    unit: import("@highstate/contract").InstanceModel
    state: import("../shared").InstanceState
  }
}>({
  scenario: async (
    {
      project,
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
      createUnit,
      createMockLibrary,
      createDeployedUnitState,
      createContext,
      createOperation,
      setupImmediateLocking,
      setupPersistenceMocks,
    },
    use,
  ) => {
    const unit = createUnit("A")
    const state = createDeployedUnitState(unit)
    state.librarySnapshotId = "old"
    state.libraryPackageVersionId = "old-package"
    state.model = { ...unit, args: { revision: "old" } }
    unit.args = { revision: "new" }
    const library = createMockLibrary()
    const oldLibrary = structuredClone(library)
    oldLibrary.components[unit.type] = { ...oldLibrary.components[unit.type], inputs: {} }

    const snapshot = (id: string) =>
      ({
        id,
        model: id === "old" ? oldLibrary : library,
        packages: [
          {
            id: `${id}-package`,
            packageName: "@test/library",
            version: id === "old" ? "1.0.0" : "2.0.0",
          },
        ],
        sourceManifest: { owners: { [`components:${unit.type}`]: "@test/library" } },
      }) as unknown as ProjectLibrarySnapshot

    const projectLibrary = {
      historicalSnapshot: vi.fn(async (_projectId: string, id: string) => snapshot(id)),
      getSnapshotUnitSources: vi.fn(async () => [{ unitType: unit.type, sourceHash: 12345 }]),
    } as unknown as ProjectLibraryService

    const context = await createContext({
      instances: [unit],
      states: [state],
      library,
      pinned: { library, snapshotId: "new", projectLibrary },
    })

    const hashes = await context.getUpToDateInputHashOutput(unit)

    Object.assign(state, {
      selfHash: hashes.selfHash,
      inputHash: hashes.inputHash,
      dependencyOutputHash: hashes.dependencyOutputHash,
    })

    setupImmediateLocking()
    setupPersistenceMocks({ instances: [unit] })

    await use({
      context,
      unit,
      state,
      runtime: type => {
        const operation = createOperation({
          type,
          requestedInstanceIds: [],
          phases:
            type === "recreate"
              ? [
                  { type: "destroy", instances: [{ id: unit.id, message: "destroy" }] },
                  { type: "update", instances: [{ id: unit.id, message: "update" }] },
                ]
              : [{ type, instances: [{ id: unit.id, message: type }] }],
        })

        operation.librarySnapshotId = "new"
        return new RuntimeOperation(
          project,
          operation,
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
          logger,
          libraryService,
          projectPortService,
          projectLibrary,
          context,
        )
      },
    })
  },
})

describe("phase execution provenance", () => {
  provenanceTest(
    "includes package changes and structured upgrades in plans",
    async ({ scenario, expect }) => {
      const { context, unit } = scenario
      expect(context.hasExecutionUpgrade(unit.id)).toBe(true)
      const phases = createOperationPlan(context, "update", [unit.id], {})

      expect(phases[0].instances[0].libraryPackageUpgrade).toEqual({
        packageName: "@test/library",
        previousVersion: "1.0.0",
        version: "2.0.0",
        previousLibraryPackageVersionId: "old-package",
        libraryPackageVersionId: "new-package",
      })
    },
  )

  provenanceTest(
    "detects complete snapshot changes even when the owning package stays equal",
    async ({ scenario, expect }) => {
      scenario.state.libraryPackageVersionId = "new-package"
      expect(scenario.context.hasExecutionUpgrade(scenario.unit.id)).toBe(true)
      scenario.state.librarySnapshotId = "new"
      expect(scenario.context.hasExecutionUpgrade(scenario.unit.id)).toBe(false)
    },
  )

  provenanceTest(
    "recreates using old destroy definitions and new update provenance",
    async ({ scenario, runnerBackend, runner, unitOutputService, expect }) => {
      runnerBackend.destroy.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          operationType: "destroy",
          provenance: { librarySnapshotId: "old", libraryPackageVersionId: "old-package" },
        })
      })

      runnerBackend.update.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          provenance: { librarySnapshotId: "new", libraryPackageVersionId: "new-package" },
        })
      })

      await scenario.runtime("recreate").operateSafe()

      expect(runnerBackend.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          librarySnapshotId: "old",
          executionPhase: "destroy",
          config: expect.objectContaining({ args: { revision: "old" } }),
        }),
      )

      expect(runnerBackend.update).toHaveBeenCalledWith(
        expect.objectContaining({
          librarySnapshotId: "new",
          executionPhase: "update",
          config: expect.objectContaining({ args: { revision: "new" } }),
        }),
      )

      const parsedLibrary = unitOutputService.parseUnitOutputs.mock.calls[0][0].libraryModel
      expect(parsedLibrary?.components[scenario.unit.type].inputs).toEqual({})
      expect(scenario.state.librarySnapshotId).toBe("new")
      expect(scenario.state.libraryPackageVersionId).toBe("new-package")
    },
  )

  provenanceTest(
    "refreshes with historical code without advancing deployed provenance or hashes",
    async ({ scenario, runnerBackend, runner, expect }) => {
      const previousHash = scenario.state.inputHash

      runnerBackend.refresh.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          operationType: "refresh",
          provenance: { librarySnapshotId: "old", libraryPackageVersionId: "old-package" },
        })
      })

      await scenario.runtime("refresh").operateSafe()

      expect(runnerBackend.refresh).toHaveBeenCalledWith(
        expect.objectContaining({ librarySnapshotId: "old", executionPhase: "refresh" }),
      )

      expect(scenario.state.librarySnapshotId).toBe("old")
      expect(scenario.state.inputHash).toBe(previousHash)
    },
  )

  provenanceTest(
    "does not short-circuit snapshot upgrades when input hashes match",
    async ({ scenario, runnerBackend, runner, expect }) => {
      runnerBackend.update.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          provenance: { librarySnapshotId: "new", libraryPackageVersionId: "new-package" },
        })
      })

      await scenario.runtime("update").operateSafe()
      expect(runnerBackend.update).toHaveBeenCalledOnce()
      expect(scenario.state.librarySnapshotId).toBe("new")
    },
  )

  provenanceTest(
    "preserves deployed provenance when outputs fail validation",
    async ({ scenario, runnerBackend, runner, unitOutputService, expect }) => {
      runnerBackend.update.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          provenance: { librarySnapshotId: "new", libraryPackageVersionId: "new-package" },
        })
      })

      unitOutputService.parseUnitOutputs.mockResolvedValue({
        entitySnapshotError: "Invalid outputs",
      } as never)

      await scenario.runtime("update").operateSafe()
      expect(scenario.state.librarySnapshotId).toBe("old")
      expect(scenario.state.model?.args).toEqual({ revision: "old" })
    },
  )

  provenanceTest("preserves deployed provenance during preview", async ({ scenario, expect }) => {
    await scenario.runtime("preview").operateSafe()
    expect(scenario.state.librarySnapshotId).toBe("old")
    expect(scenario.state.libraryPackageVersionId).toBe("old-package")
    expect(scenario.state.model?.args).toEqual({ revision: "old" })
  })

  provenanceTest(
    "rejects completion from a different execution snapshot",
    async ({ scenario, runnerBackend, runner, operationService, expect }) => {
      runnerBackend.update.mockImplementation(async options => {
        runner.emitCompletion(options.stateId, {
          provenance: { librarySnapshotId: "old", libraryPackageVersionId: "old-package" },
        })
      })

      await scenario.runtime("update").operateSafe()
      expect(scenario.state.librarySnapshotId).toBe("old")

      expect(operationService.updateOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { status: "failed" },
      )
    },
  )

  provenanceTest(
    "cancels the image barrier before creating operation states or locks",
    async ({
      scenario,
      runnerBackend,
      instanceStateService,
      instanceLockService,
      operationService,
      expect,
    }) => {
      const waiting = createDeferred<void>()

      runnerBackend.prepareOperation = vi.fn(
        async (_projectId, _operationId, snapshots, signal) => {
          expect(snapshots).toEqual(["new", "old"])
          waiting.resolve()

          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          )
        },
      )

      const runtime = scenario.runtime("recreate")
      const running = runtime.operateSafe()
      await waiting.promise
      runtime.cancel()
      await running
      expect(instanceStateService.createOperationStates).not.toHaveBeenCalled()
      expect(instanceLockService.lockInstances).not.toHaveBeenCalled()

      expect(operationService.updateOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { status: "cancelled" },
      )

      expect(scenario.state.librarySnapshotId).toBe("old")
    },
  )
})
