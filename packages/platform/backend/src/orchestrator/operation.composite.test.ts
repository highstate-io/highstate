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
})
