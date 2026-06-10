import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { operationTest } from "./operation.test-utils"

describe("Operation - Destroy", () => {
  operationTest(
    "calls runner destroy and marks operation completed",
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

      runner.setDestroyImpl(async () => {})

      const operation = createOperation({
        type: "destroy",
        requestedInstanceIds: [unit.id],
        phases: [
          {
            type: "destroy",
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
      expect(runnerBackend.destroy).toHaveBeenCalledTimes(1)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )

  operationTest(
    "destroys ghost instances when dependency is state-only",
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
      createMockLibrary,
      setupPersistenceMocks,
      setupImmediateLocking,
      expect,
    }) => {
      // arrange
      const dependency = createUnit("Dependency")
      const ghost = {
        ...createUnit("Ghost"),
        inputs: {
          dependency: [
            {
              instanceId: dependency.id,
              output: "value",
            },
          ],
        },
      }

      const dependencyState = createDeployedUnitState(dependency)
      const ghostState = createDeployedUnitState(ghost)

      const library = createMockLibrary()

      libraryService.getLibraryModel.mockResolvedValue(library)
      libraryService.getResolvedUnitSources.mockResolvedValue([
        {
          unitType: "component.v1",
          sourceHash: 12345,
          projectPath: "test",
          allowedDependencies: [],
        },
        {
          unitType: "composite.v1",
          sourceHash: 12345,
          projectPath: "test",
          allowedDependencies: [],
        },
      ])

      projectModelService.getProjectModel.mockResolvedValue([
        {
          instances: [],
          virtualInstances: [],
          hubs: [],
          ghostInstances: [ghost],
        },
        project,
      ])

      instanceStateService.getInstanceStates.mockResolvedValue([dependencyState, ghostState])

      await setupPersistenceMocks({ instances: [ghost, dependency] })
      setupImmediateLocking()

      runner.setDestroyImpl(async () => {})

      const operation = createOperation({
        type: "destroy",
        requestedInstanceIds: [ghost.id],
        phases: [
          {
            type: "destroy",
            instances: [{ id: ghost.id, message: "ghost cleanup", parentId: undefined }],
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
      expect(runnerBackend.destroy).toHaveBeenCalledTimes(1)
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
