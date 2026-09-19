import { describe } from "vitest"
import { RuntimeOperation } from "./operation"
import { createDeferred, operationTest } from "./operation.test-utils"

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

      libraryService.getLibraryModelCore.mockResolvedValue(library)
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

      projectModelService.getProjectModelCore.mockResolvedValue([
        {
          instances: [],
          virtualInstances: [],
          hubs: [],
          ghostInstances: [ghost],
        },
        project,
      ])

      instanceStateService.getInstanceStatesCore.mockResolvedValue([dependencyState, ghostState])

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

  operationTest(
    "waits for dependents loaded before their dependencies before destroying",
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
      const server = { ...createUnit("Server"), parentId: composite.id }
      const script = {
        ...createUnit("Script"),
        parentId: composite.id,
        inputs: {
          dependency: [{ instanceId: server.id, output: "value" }],
        },
      }
      const cluster = {
        ...createUnit("Cluster"),
        parentId: composite.id,
        inputs: {
          dependency: [{ instanceId: script.id, output: "value" }],
        },
      }
      const instances = [composite, server, script, cluster]

      const compositeState = createDeployedUnitState(composite)
      const serverState = createDeployedUnitState(server)
      const scriptState = createDeployedUnitState(script)
      scriptState.resolvedInputs = {
        dependency: [{ stateId: serverState.id, output: "value" }],
      }
      const clusterState = createDeployedUnitState(cluster)
      clusterState.resolvedInputs = {
        dependency: [{ stateId: scriptState.id, output: "value" }],
      }

      // Database ordering is unspecified, so dependents may be loaded before their dependencies.
      await createContext({
        instances,
        states: [clusterState, scriptState, serverState, compositeState],
      })
      setupImmediateLocking()
      setupPersistenceMocks({ instances })

      const clusterDone = createDeferred<void>()
      const scriptDone = createDeferred<void>()
      runner.setDestroyImpl(async input => {
        if (input.instanceName === "Cluster") {
          await clusterDone.promise
        }

        if (input.instanceName === "Script") {
          await scriptDone.promise
        }
      })

      const operation = createOperation({
        type: "destroy",
        requestedInstanceIds: [composite.id],
        phases: [
          {
            type: "destroy",
            instances: [
              { id: composite.id, message: "requested", parentId: undefined },
              { id: cluster.id, message: "child", parentId: composite.id },
              { id: script.id, message: "child", parentId: composite.id },
              { id: server.id, message: "child", parentId: composite.id },
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

      const operationPromise = runtimeOperation.operateSafe()

      await expect.poll(() => runnerBackend.destroy.mock.calls.length).toBe(1)
      expect(runnerBackend.destroy.mock.calls[0]?.[0].instanceName).toBe("Cluster")

      clusterDone.resolve()
      await expect.poll(() => runnerBackend.destroy.mock.calls.length).toBe(2)
      expect(runnerBackend.destroy.mock.calls[1]?.[0].instanceName).toBe("Script")

      scriptDone.resolve()
      await operationPromise

      expect(runnerBackend.destroy.mock.calls.map(([input]) => input.instanceName)).toEqual([
        "Cluster",
        "Script",
        "Server",
      ])
      expect(operationService.markOperationFinished).toHaveBeenCalledWith(
        project.id,
        operation.id,
        "completed",
      )
    },
  )
})
