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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
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
        entitySnapshotService,
        unitOutputService,
        logger,
        libraryService,
        projectPortService,
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

  operationTest(
    "recalculates using phase parent when state parent is stale and outside operation",
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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
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
      const grandParent = createComposite("GrandParent")
      const parent = {
        ...createComposite("Parent"),
        parentId: grandParent.id,
      }
      const oldParent = createComposite("OldParent")
      const child = {
        ...createUnit("Child"),
        parentId: parent.id,
      }

      const grandParentState = createDeployedUnitState(grandParent)
      const parentState = createDeployedUnitState(parent)
      const oldParentState = createDeployedUnitState(oldParent)
      const childState = createDeployedUnitState(child)

      // simulate state/model drift: child state still points to old parent state
      childState.parentInstanceId = oldParent.id

      await createContext({
        instances: [grandParent, parent, child],
        states: [grandParentState, parentState, oldParentState, childState],
      })

      setupImmediateLocking()
      setupPersistenceMocks({ instances: [grandParent, parent, child, oldParent] })

      const inOperationStateIds = new Set([grandParent.id, parent.id, child.id])
      const baseUpdateMock = instanceStateService.updateOperationState.getMockImplementation()

      instanceStateService.updateOperationState.mockImplementation(
        async (projectId, stateId, operationId, options) => {
          if (!inOperationStateIds.has(stateId as typeof grandParent.id)) {
            throw new Error(`No operation state row for stateId ${stateId}`)
          }

          if (!baseUpdateMock) {
            throw new Error("updateOperationState base mock is not initialized")
          }

          return await baseUpdateMock(projectId, stateId, operationId, options)
        },
      )

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [child.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: grandParent.id, message: "ancestor", parentId: undefined },
              { id: parent.id, message: "parent", parentId: grandParent.id },
              { id: child.id, message: "requested", parentId: parent.id },
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

      // act
      await runtimeOperation.operateSafe()

      // assert
      const recalculatedOldParent = instanceStateService.updateOperationState.mock.calls.some(
        ([, stateId]) => stateId === oldParent.id,
      )

      expect(recalculatedOldParent).toBe(false)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )

  operationTest(
    "keeps composite parents deployed during ghost cleanup destroy phase in update operations",
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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
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
      const grandParent = createComposite("GrandParent")
      const parent = {
        ...createComposite("Parent"),
        parentId: grandParent.id,
      }
      const child = {
        ...createUnit("Child"),
        parentId: parent.id,
      }
      const ghostChild = {
        ...createUnit("GhostChild"),
        parentId: parent.id,
      }

      const grandParentState = createDeployedUnitState(grandParent)
      const parentState = createDeployedUnitState(parent)
      const childState = createDeployedUnitState(child)
      const ghostChildState = createDeployedUnitState(ghostChild)

      await createContext({
        instances: [grandParent, parent, child],
        states: [grandParentState, parentState, childState, ghostChildState],
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [grandParent, parent, child, ghostChild] })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [parent.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: grandParent.id, message: "ancestor", parentId: undefined },
              { id: parent.id, message: "requested", parentId: grandParent.id },
              { id: child.id, message: "child", parentId: parent.id },
            ],
          },
          {
            type: "destroy",
            instances: [
              { id: ghostChild.id, message: "ghost cleanup", parentId: parent.id },
              { id: parent.id, message: "parent of included child", parentId: grandParent.id },
              { id: grandParent.id, message: "parent of included child", parentId: undefined },
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

      // act
      await runtimeOperation.operateSafe()

      // assert
      const parentStateUpdates = instanceStateService.updateOperationState.mock.calls
        .filter(([, stateId]) => stateId === parent.id)
        .map(([, , , options]) => options.instanceState?.status)
        .filter((status): status is NonNullable<typeof status> => status != null)

      const grandParentStateUpdates = instanceStateService.updateOperationState.mock.calls
        .filter(([, stateId]) => stateId === grandParent.id)
        .map(([, , , options]) => options.instanceState?.status)
        .filter((status): status is NonNullable<typeof status> => status != null)

      expect(parentStateUpdates).toContain("deployed")
      expect(grandParentStateUpdates).toContain("deployed")
      expect(parentStateUpdates).not.toContain("undeployed")
      expect(grandParentStateUpdates).not.toContain("undeployed")
    },
  )

  operationTest(
    "marks composite parents undeployed after ghost cleanup when no unit descendants remain",
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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
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
      const grandParent = createComposite("GrandParent")
      const parent = {
        ...createComposite("Parent"),
        parentId: grandParent.id,
      }
      const ghostChild = {
        ...createUnit("GhostChild"),
        parentId: parent.id,
      }

      const grandParentState = createDeployedUnitState(grandParent)
      const parentState = createDeployedUnitState(parent)
      const ghostChildState = createDeployedUnitState(ghostChild)

      await createContext({
        instances: [grandParent, parent],
        states: [grandParentState, parentState, ghostChildState],
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances: [grandParent, parent, ghostChild] })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [parent.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: grandParent.id, message: "ancestor", parentId: undefined },
              { id: parent.id, message: "requested", parentId: grandParent.id },
            ],
          },
          {
            type: "destroy",
            instances: [
              { id: ghostChild.id, message: "ghost cleanup", parentId: parent.id },
              { id: parent.id, message: "parent of included child", parentId: grandParent.id },
              { id: grandParent.id, message: "parent of included child", parentId: undefined },
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

      // act
      await runtimeOperation.operateSafe()

      // assert
      const parentStateUpdates = instanceStateService.updateOperationState.mock.calls
        .filter(([, stateId]) => stateId === parent.id)
        .map(([, , , options]) => options.instanceState?.status)
        .filter((status): status is NonNullable<typeof status> => status != null)

      const grandParentStateUpdates = instanceStateService.updateOperationState.mock.calls
        .filter(([, stateId]) => stateId === grandParent.id)
        .map(([, , , options]) => options.instanceState?.status)
        .filter((status): status is NonNullable<typeof status> => status != null)

      expect(parentStateUpdates).toContain("undeployed")
      expect(grandParentStateUpdates).toContain("undeployed")
    },
  )

  operationTest(
    "marks containing composites failed and cancelled siblings cancelled",
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
      entitySnapshotService,
      unitOutputService,
      libraryService,
      projectPortService,
      createComposite,
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      const grandParent = createComposite("GrandParent")
      const composite = { ...createComposite("Parent"), parentId: grandParent.id }
      const failingUnit = { ...createUnit("Failing"), parentId: composite.id }
      const cancelledUnit = {
        ...createUnit("Cancelled"),
        parentId: composite.id,
        inputs: {
          dependency: [{ instanceId: failingUnit.id, output: "value" }],
        },
      }
      const instances = [grandParent, composite, failingUnit, cancelledUnit]

      await createContext({
        instances,
        states: instances.map(createDeployedUnitState),
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances })

      runnerBackend.update.mockImplementation(async input => {
        if (input.instanceName === "Failing") {
          throw new Error("primary failure")
        }
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [grandParent.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: grandParent.id, message: "requested", parentId: undefined },
              { id: composite.id, message: "child", parentId: grandParent.id },
              { id: failingUnit.id, message: "child", parentId: composite.id },
              { id: cancelledUnit.id, message: "child", parentId: composite.id },
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

      await runtimeOperation.operateSafe()

      const finalStatuses = new Map(
        instanceStateService.updateOperationState.mock.calls
          .filter(([, , , options]) => options.operationState?.finishedAt != null)
          .map(([, stateId, , options]) => [stateId, options.operationState?.status]),
      )
      expect(finalStatuses.get(failingUnit.id)).toBe("failed")
      expect(finalStatuses.get(cancelledUnit.id)).toBe("cancelled")
      expect(finalStatuses.get(composite.id)).toBe("failed")
      expect(finalStatuses.get(grandParent.id)).toBe("failed")

      for (const compositeId of [composite.id, grandParent.id]) {
        const compositeLogs = operationService.appendLog.mock.calls.filter(
          ([, , stateId]) => stateId === compositeId,
        )
        expect(compositeLogs).toHaveLength(1)
        expect(compositeLogs[0]?.[3]).toContain(`Unit "${failingUnit.id}" failed first`)
        expect(compositeLogs[0]?.[3]).toContain("primary failure")
        expect(compositeLogs[0]?.[3]).not.toContain(cancelledUnit.id)
      }
      expect(operationService.updateOperation).toHaveBeenCalledWith(
        project.id,
        operation.id,
        expect.objectContaining({ status: "failed" }),
      )
    },
  )

  operationTest(
    "includes every failed child unit in the composite error",
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
      createComposite,
      createUnit,
      createDeployedUnitState,
      createOperation,
      createContext,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      const composite = createComposite("Parent")
      const firstUnit = { ...createUnit("First"), parentId: composite.id }
      const secondUnit = { ...createUnit("Second"), parentId: composite.id }
      const instances = [composite, firstUnit, secondUnit]

      await createContext({
        instances,
        states: instances.map(createDeployedUnitState),
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances })

      runner.setAutoCompletion(false)
      const bothUnitsStarted = createDeferred<void>()
      let startedUnitCount = 0
      runner.setUpdateImpl(async () => {
        startedUnitCount++
        if (startedUnitCount === 2) {
          bothUnitsStarted.resolve()
        }
      })

      const operation = createOperation({
        type: "update",
        requestedInstanceIds: [composite.id],
        phases: [
          {
            type: "update",
            instances: [
              { id: composite.id, message: "requested", parentId: undefined },
              { id: firstUnit.id, message: "child", parentId: composite.id },
              { id: secondUnit.id, message: "child", parentId: composite.id },
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

      const operatePromise = runtimeOperation.operateSafe()
      await bothUnitsStarted.promise
      runner.emitError(firstUnit.id, "first error")
      runner.emitError(secondUnit.id, "second error")
      await operatePromise

      const compositeLog = operationService.appendLog.mock.calls.find(
        ([, , stateId]) => stateId === composite.id,
      )?.[3]
      expect(compositeLog).toContain(`Unit "${firstUnit.id}" failed first`)
      expect(compositeLog).toContain(`Unit "${firstUnit.id}" failed`)
      expect(compositeLog).toContain("first error")
      expect(compositeLog).toContain(`Unit "${secondUnit.id}" failed`)
      expect(compositeLog).toContain("second error")
    },
  )
})
