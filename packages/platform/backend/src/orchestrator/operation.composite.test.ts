import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { createDeferred, operationTest } from "./operation.test-utils"

describe("Operation - Composite", () => {
  operationTest(
    "finalizes composite only after children complete",
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
      createComposite,
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      // arrange
      const composite = createComposite("Parent")
      const child = {
        ...createUnit("Child"),
        parentId: composite.id,
      }

      const compositeState = createDeployedUnitState(composite)
      const childState = createDeployedUnitState(child)

      await createContext({
        instances: [composite, child],
        states: [compositeState, childState],
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [composite, child] })

      runner.setAutoCompletion(false)

      const updateStarted = createDeferred<void>()
      const updateDeferred = createDeferred<void>()
      runner.setUpdateImpl(async () => {
        updateStarted.resolve(undefined)
        await updateDeferred.promise
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [composite.id, child.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: composite.id, message: "requested", parentId: undefined },
              { id: child.id, message: "requested", parentId: composite.id },
            ],
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

      const compositeWasFinalized = () => {
        return instanceStateService.updateOperationState.mock.calls.some(call => {
          const stateId = call[1]
          const options = call[3]
          if (stateId !== composite.id) {
            return false
          }

          if (!options || typeof options !== "object") {
            return false
          }

          const maybeOptions = options as { operationState?: { finishedAt?: Date | null } }
          return maybeOptions.operationState?.finishedAt != null
        })
      }

      // act
      const operatePromise = runtimeOperation.operateSafe()

      await updateStarted.promise

      // assert
      expect(runnerBackend.update).toHaveBeenCalledTimes(1)
      expect(compositeWasFinalized()).toBe(false)

      updateDeferred.resolve()
      runner.emitCompletion(child.id, { operationType: "update" })
      await operatePromise

      expect(compositeWasFinalized()).toBe(true)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
