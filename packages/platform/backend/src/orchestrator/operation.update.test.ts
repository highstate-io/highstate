import type { InstanceModel } from "@highstate/contract"
import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { createDeferred, operationTest } from "./operation.test-utils"

describe("Operation - Update", () => {
  operationTest(
    "waits for dependency update to complete before running dependent",
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
      const unitA = createUnit("A")
      const unitB: InstanceModel = {
        ...createUnit("B"),
        inputs: {
          dependency: [{ instanceId: unitA.id, output: "value" }],
        },
      }

      const stateA = createDeployedUnitState(unitA)
      const stateB = createDeployedUnitState(unitB)

      await createContext({ instances: [unitA, unitB], states: [stateA, stateB] })

      setupImmediateLocking()
      setupPersistenceMocks({ instances: [unitA, unitB] })

      const aStarted = createDeferred<void>()
      const aDone = createDeferred<void>()
      let canRunB = false

      runner.setUpdateImpl(async input => {
        if (input.instanceName === "A") {
          aStarted.resolve(undefined)
          await aDone.promise
          canRunB = true
          return
        }

        if (input.instanceName === "B") {
          expect(canRunB).toBe(true)
          return
        }

        throw new Error(`unexpected unit: ${input.instanceName}`)
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [unitB.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: unitA.id, message: "dependency", parentId: undefined },
              { id: unitB.id, message: "requested", parentId: undefined },
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

      // act
      const operationPromise = runtimeOperation.operateSafe()

      // assert
      await aStarted.promise
      expect(runnerBackend.update).toHaveBeenCalledTimes(1)
      expect(runnerBackend.update.mock.calls[0]?.[0].instanceName).toBe("A")

      // act
      aDone.resolve(undefined)
      await operationPromise

      // assert
      expect(runnerBackend.update).toHaveBeenCalledTimes(2)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
