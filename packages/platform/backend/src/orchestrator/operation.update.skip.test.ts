import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("RuntimeOperation - Update Short-Circuit", () => {
  operationTest(
    "skips unit update when selfHash and dependencyOutputHash match",
    async ({
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
      createUnit,
      createDeployedUnitState,
      createContext,
      createOperation,
      setupImmediateLocking,
      setupPersistenceMocks,
      expect,
    }) => {
      // arrange
      const unit = createUnit("A")
      const state = createDeployedUnitState(unit)

      const context = await createContext({ instances: [unit], states: [state] })

      const expected = await context.getUpToDateInputHashOutput(unit)
      state.selfHash = expected.selfHash
      state.dependencyOutputHash = expected.dependencyOutputHash
      instanceStateService.getInstanceStates.mockResolvedValue([state])

      setupImmediateLocking()
      setupPersistenceMocks({ instances: [unit] })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [],
        phases: [
          {
            type: "update",
            instances: [{ id: unit.id, message: "explicitly requested", parentId: undefined }],
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
      expect(runnerBackend.update).not.toHaveBeenCalled()

      const skipCall = instanceStateService.updateOperationState.mock.calls.find(
        (_call): boolean => {
          const options = _call[3]
          return options.operationState?.status === "skipped"
        },
      )

      expect(skipCall).toBeDefined()

      const skipOptions = skipCall?.[3]
      expect(skipOptions?.instanceState).toEqual({
        inputHash: expected.inputHash,
      })

      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
