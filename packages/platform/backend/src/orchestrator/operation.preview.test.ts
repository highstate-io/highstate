import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("Operation - Preview", () => {
  operationTest(
    "calls runner preview and does not change instance status",
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

      runner.setPreviewImpl(async () => {})

      const operation = createOperation({
        type: "preview",
        requestedInstanceIds: [unit.id],
        phases: [
          {
            type: "preview",
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
      expect(runnerBackend.preview).toHaveBeenCalledTimes(1)

      const updateOperationStateCalls = instanceStateService.updateOperationState.mock.calls
      const anyPreviewWriteChangingInstanceStatus = updateOperationStateCalls.some(call => {
        const options = call[3] as unknown
        if (!options || typeof options !== "object") {
          return false
        }

        const maybeOptions = options as {
          instanceState?: {
            status?: unknown
          }
        }

        return maybeOptions.instanceState?.status !== undefined
      })

      expect(anyPreviewWriteChangingInstanceStatus).toBe(false)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
