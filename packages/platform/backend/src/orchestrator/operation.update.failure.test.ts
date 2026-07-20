import type { InstanceModel } from "@highstate/contract"
import { describe, vi } from "vitest"
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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
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
        entitySnapshotService,
        unitOutputService,
        logger,
        libraryService,
        projectPortService,
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

  operationTest(
    "only reports the unit that failed",
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
      libraryService,
      projectPortService,
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      // arrange
      const dependency = createUnit("dependency")
      const dependent: InstanceModel = {
        ...createUnit("dependent"),
        inputs: {
          dependency: [{ instanceId: dependency.id, output: "value" }],
        },
      }
      const dependencyState = createDeployedUnitState(dependency)
      const dependentState = createDeployedUnitState(dependent)

      await createContext({
        instances: [dependency, dependent],
        states: [dependencyState, dependentState],
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [dependency, dependent] })

      runner.setUpdateImpl(async input => {
        if (input.instanceName === "dependency") {
          throw new Error("real unit failure")
        }
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [dependent.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: dependency.id, message: "dependency", parentId: undefined },
              { id: dependent.id, message: "requested", parentId: undefined },
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
        entitySnapshotService,
        unitOutputService,
        logger,
        libraryService,
        projectPortService,
      )
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

      // act
      await runtimeOperation.operateSafe()

      // assert
      const unitLogCalls = operationService.appendLog.mock.calls.filter(call => call[2] !== null)
      expect(unitLogCalls).toHaveLength(1)
      expect(unitLogCalls[0]?.[2]).toBe(dependencyState.id)
      expect(unitLogCalls[0]?.[3]).toContain("real unit failure")
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(consoleError.mock.calls[0]?.[0]).toMatchObject({ message: "real unit failure" })

      consoleError.mockRestore()
    },
  )
})
