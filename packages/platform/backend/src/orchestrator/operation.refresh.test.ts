import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("Operation - Refresh", () => {
  operationTest(
    "calls runner refresh and marks operation completed",
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
      // arrange
      const unit = createUnit("A")
      const state = createDeployedUnitState(unit)

      await createContext({ instances: [unit], states: [state] })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [unit] })

      runner.setRefreshImpl(async () => {})

      const operation = createOperation({
        type: "refresh",
        requestedInstanceIds: [unit.id],
        phases: [
          {
            type: "refresh",
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

      // act
      await runtimeOperation.operateSafe()

      // assert
      expect(runnerBackend.refresh).toHaveBeenCalledTimes(1)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
