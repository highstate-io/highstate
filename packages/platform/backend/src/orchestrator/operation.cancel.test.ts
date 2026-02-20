import type { Operation } from "../database"
import { describe } from "vitest"
import { AbortError } from "../common"
import { RuntimeOperation } from "./operation"
import { createDeferred, operationTest } from "./operation.test-utils"

describe("Operation - Cancel", () => {
  operationTest(
    "cancels an in-flight unit and marks operation cancelled",
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

      const cancelled = createDeferred<void>()
      operationService.updateOperation.mockImplementation(
        async (_projectId, _operationId, patch) => {
          if (patch.status === "cancelled") {
            cancelled.resolve(undefined)
          }

          return {} as unknown as Operation
        },
      )

      const started = createDeferred<void>()
      runner.setUpdateImpl(async input => {
        started.resolve(undefined)

        const signal = input.signal
        if (!signal) {
          throw new Error("expected runner update to receive abort signal")
        }

        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AbortError("Operation aborted")), {
            once: true,
          })
        })
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

      // act
      const operationPromise = runtimeOperation.operateSafe()
      await started.promise

      runtimeOperation.cancel()

      // assert
      await cancelled.promise

      // act
      await operationPromise

      // assert
      expect(operationService.updateOperation).toHaveBeenCalledWith(
        project.id,
        operation.id,
        expect.objectContaining({ status: "cancelled" }),
      )
    },
  )
})
