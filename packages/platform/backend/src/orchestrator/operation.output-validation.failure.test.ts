import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("Operation - Output Validation Failure", () => {
  operationTest(
    "writes instance log and fails instance when unit outputs are invalid",
    async ({
      project,
      logger,
      runnerBackend,
      runner,
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
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      const unit = createUnit("A")
      const state = createDeployedUnitState(unit)

      await createContext({ instances: [unit], states: [state] })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [unit] })

      unitOutputService.parseUnitOutputs.mockResolvedValue({
        outputHash: null,
        statusFields: null,
        terminals: null,
        pages: null,
        triggers: null,
        secrets: null,
        workers: null,
        exportedArtifactIds: null,
        entitySnapshotError: "invalid entity schema",
        entitySnapshotPayload: null,
      })

      runner.setAutoCompletion(false)
      runner.emitCompletion(unit.id, {
        operationType: "update",
        rawOutputs: {
          value: { value: { some: "output" } },
        },
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [unit.id],
        phases: [
          {
            type: "update",
            instances: [{ id: unit.id, message: "requested", parentId: undefined }],
          },
        ],
      })

      const runtimeOperation = new RuntimeOperation(
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
      )

      await runtimeOperation.operateSafe()

      expect(operationService.appendLog).toHaveBeenCalledWith(
        project.id,
        operation.id,
        state.id,
        expect.stringContaining("Failed to parse unit outputs"),
      )

      expect(instanceStateService.updateOperationState).toHaveBeenCalledWith(
        project.id,
        state.id,
        operation.id,
        expect.any(Object),
      )

      const wasMarkedFailed = instanceStateService.updateOperationState.mock.calls.some(call => {
        const patch = call[3] as unknown
        if (!patch || typeof patch !== "object") {
          return false
        }

        const maybePatch = patch as {
          operationState?: { status?: unknown }
          instanceState?: { status?: unknown }
        }

        return (
          maybePatch.operationState?.status === "failed" &&
          maybePatch.instanceState?.status === "failed"
        )
      })

      expect(wasMarkedFailed).toBe(true)
    },
  )
})
