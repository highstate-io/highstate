import type { InstanceId } from "@highstate/contract"
import type { Logger } from "pino"
import type {
  EntitySnapshotService,
  InstanceLockService,
  InstanceStateService,
  OperationService,
  ProjectModelService,
  ProjectUnlockService,
  SecretService,
  UnitExtraService,
  UnitOutputService,
} from "../business"
import type { ArtifactService } from "../business/artifact"
import type { DatabaseManager, Operation, Project } from "../database"
import type { LibraryBackend } from "../library"
import type { RunnerBackend } from "../runner"
import {
  finalOperationStatuses,
  type OperationLaunchInput,
  type OperationPhase,
  type OperationPlanInput,
  operationOptionsSchema,
} from "../shared"
import { finalInstanceOperationStatuses } from "../shared/models/project/state"
import { RuntimeOperation } from "./operation"
import { OperationContext } from "./operation-context"
import { createOperationPlan } from "./operation-plan"

export class OperationManager {
  constructor(
    private readonly runnerBackend: RunnerBackend,
    private readonly libraryBackend: LibraryBackend,
    private readonly artifactService: ArtifactService,
    private readonly instanceLockService: InstanceLockService,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly operationService: OperationService,
    private readonly secretService: SecretService,
    private readonly instanceStateService: InstanceStateService,
    private readonly projectModelService: ProjectModelService,
    private readonly unitExtraService: UnitExtraService,
    private readonly entitySnapshotService: EntitySnapshotService,
    private readonly unitOutputService: UnitOutputService,
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {
    this.projectUnlockService.registerUnlockTask(
      //
      "recover-system-state",
      projectId => this.recoverSystemState(projectId),
    )
  }

  private readonly runtimeOperations = new Map<string, RuntimeOperation>()

  /**
   * Plans the project operation without executing it.
   *
   * @param request The operation request to plan.
   * @returns The planned phases for the operation.
   */
  async plan(request: OperationPlanInput): Promise<OperationPhase[]> {
    this.logger.info({ request }, "planning operation")

    const project = await this.database.backend.project.findUnique({
      where: { id: request.projectId },
    })

    if (!project) {
      throw new Error(`Project with ID "${request.projectId}" not found`)
    }

    const context = await OperationContext.load(
      request.projectId,
      this.libraryBackend,
      this.instanceStateService,
      this.projectModelService,
      undefined,
      undefined,
      this.logger,
    )

    const options = operationOptionsSchema.parse(request.options ?? {})

    return createOperationPlan(context, request.type, request.instanceIds, options)
  }

  /**
   * Launches the project operation.
   *
   * @param request The operation request to launch.
   */
  async launch(request: OperationLaunchInput): Promise<Operation> {
    const options = operationOptionsSchema.parse(request.options ?? {})

    const operation = await this.operationService.createOperation(
      request.projectId,
      request.meta,
      request.type,
      request.instanceIds,
      options,
    )

    this.logger.info({ operation }, "launching operation")

    const project = await this.database.backend.project.findUnique({
      where: { id: request.projectId },
    })

    if (!project) {
      throw new Error(`Project with ID "${request.projectId}" not found`)
    }

    this.startOperation(project, operation)

    return operation
  }

  /**
   * Cancels the current operation.
   * Does nothing if no operation is running.
   */
  cancel(operationId: string): void {
    const runtimeOperation = this.runtimeOperations.get(operationId)
    if (runtimeOperation) {
      runtimeOperation.cancel()
    }
  }

  cancelInstance(operationId: string, instanceId: InstanceId): void {
    const runtimeOperation = this.runtimeOperations.get(operationId)
    if (runtimeOperation) {
      runtimeOperation.cancelInstance(instanceId)
    }
  }

  private startOperation(project: Project, operation: Operation): void {
    const runtimeOperation = new RuntimeOperation(
      project,
      operation,
      this.runnerBackend,
      this.libraryBackend,
      this.artifactService,
      this.instanceLockService,
      this.operationService,
      this.secretService,
      this.instanceStateService,
      this.projectModelService,
      this.unitExtraService,
      this.entitySnapshotService,
      this.unitOutputService,
      this.logger.child({ operationId: operation.id }),
    )

    this.runtimeOperations.set(operation.id, runtimeOperation)
    void runtimeOperation.operateSafe().finally(() => this.runtimeOperations.delete(operation.id))
  }

  private async recoverSystemState(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      // 1. process lost operations
      const activeOperations = await tx.operation.findMany({
        where: {
          status: {
            not: {
              in: finalOperationStatuses,
            },
          },
        },
      })

      if (activeOperations.length > 0) {
        // mark all lost operations as failed
        for (const operation of activeOperations) {
          await tx.operation.update({
            where: { id: operation.id },
            data: {
              status: "failed",
              finishedAt: new Date(),
            },
          })

          void this.operationService.appendLog(
            projectId,
            operation.id,
            null,
            "Operation was interrupted",
          )
        }

        this.logger.warn(
          { projectId, operationCount: activeOperations.length },
          "marked %s lost operations as failed",
          activeOperations.length,
        )
      }

      // 2. cleanup orphaned locks
      const existingLocks = await tx.instanceLock.findMany({
        select: { stateId: true },
      })

      if (existingLocks.length > 0) {
        const stateIds = existingLocks.map(lock => lock.stateId)
        await tx.instanceLock.deleteMany({
          where: {
            stateId: {
              in: stateIds,
            },
          },
        })

        for (const lock of existingLocks) {
          this.logger.warn({ projectId, stateId: lock.stateId }, "removed orphaned lock")
        }

        this.logger.info(
          { projectId, lockCount: existingLocks.length },
          "cleaned up %s locks",
          existingLocks.length,
        )
      }

      // 3. reset instances with transient status
      const instancesToReset = await tx.instanceOperationState.findMany({
        where: {
          status: {
            not: {
              in: finalInstanceOperationStatuses,
            },
          },
        },
        select: {
          stateId: true,
          status: true,
        },
      })

      if (instancesToReset.length > 0) {
        // log each instance being reset
        for (const instance of instancesToReset) {
          this.logger.warn(
            { projectId, stateId: instance.stateId, previousStatus: instance.status },
            "resetting instance with transient status from %s to failed",
            instance.status,
          )
        }

        // reset operation states that were being processed by lost operations
        const result = await tx.instanceOperationState.updateMany({
          where: {
            status: {
              not: {
                in: finalInstanceOperationStatuses,
              },
            },
          },
          data: {
            status: "failed",
            finishedAt: new Date(),
          },
        })

        this.logger.info(
          { projectId, resetOperationCount: result.count },
          "reset %s operation states",
          result.count,
        )
      }

      // Step 4: reset attempted instance states
      const attemptedResult = await tx.instanceState.updateMany({
        where: {
          status: "attempted",
        },
        data: {
          status: "failed",
        },
      })

      if (attemptedResult.count > 0) {
        this.logger.info(
          { projectId, resetAttemptedCount: attemptedResult.count },
          "reset %s attempted instance states",
          attemptedResult.count,
        )
      }
    })
  }
}
