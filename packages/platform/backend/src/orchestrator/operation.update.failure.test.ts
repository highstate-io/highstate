import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("Operation - Update Failure", () => {
  operationTest(
    "marks operation failed when runner emits error update",
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
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      // arrange
      const unit = createUnit("A")
      const state = createDeployedUnitState(unit)

      await createContext({ instances: [unit], states: [state] })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [unit] })

      runner.setAutoCompletion(false)
      runner.emitError(unit.id, "boom")

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
        logger,
      )

      // act
      await runtimeOperation.operateSafe()

      // assert
      expect(runnerBackend.update).toHaveBeenCalledTimes(1)

      const updateOperationCalls = operationService.updateOperation.mock.calls
      const wasMarkedFailed = updateOperationCalls.some(call => {
        const patch = call[2] as unknown
        if (!patch || typeof patch !== "object") {
          return false
        }

        const maybePatch = patch as { status?: unknown }
        return maybePatch.status === "failed"
      })

      expect(wasMarkedFailed).toBe(true)
      expect(operationService.markOperationFinished).not.toHaveBeenCalled()
      expect(operationService.appendLog).toHaveBeenCalled()
    },
  )
})
