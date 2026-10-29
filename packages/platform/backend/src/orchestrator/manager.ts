import type { InstanceId } from "@highstate/contract"
import type { Logger } from "pino"
import type {
  EntitySnapshotService,
  InstanceLockService,
  InstanceStateService,
  LibraryService,
  OperationService,
  ProjectModelService,
  ProjectPortService,
  ProjectUnlockService,
  SecretService,
  UnitExtraService,
  UnitOutputService,
} from "../business"
import type { ArtifactService } from "../business/artifact"
import type { ProjectLibraryService } from "../business/project-library"
import type { DatabaseManager, Operation, Project } from "../database"
import type { LibraryBackend } from "../library"
import type { RunnerBackend } from "../runner"
import {
  finalOperationStatuses,
  type OperationLaunchInput,
  type OperationPhase,
  type OperationPlanInput,
  operationOptionsSchema,
  stableJsonStringify,
} from "../shared"
import { finalInstanceOperationStatuses } from "../shared/models/project/state"
import { RuntimeOperation } from "./operation"
import { OperationContext } from "./operation-context"
import { createOperationPlan } from "./operation-plan"
import { type ReviewedPlan, ReviewedPlanSigner } from "./reviewed-plan"
import { modelRevision } from "./revisions"

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
    private readonly libraryService: LibraryService,
    private readonly projectPortService: ProjectPortService,
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
    private readonly projectLibrary?: ProjectLibraryService,
    private readonly planSigner = new ReviewedPlanSigner(),
  ) {
    this.projectUnlockService.registerUnlockTask(
      //
      "recover-system-state",
      projectId => this.recoverSystemState(projectId),
    )
  }

  private readonly runtimeOperations = new Map<string, RuntimeOperation>()
  private readonly reviewedContexts = new WeakMap<ReviewedPlan, OperationContext>()

  /**
   * Plans the project operation without executing it.
   *
   * @param request The operation request to plan.
   * @returns The planned phases for the operation.
   */
  async plan(request: OperationPlanInput): Promise<OperationPhase[]> {
    return (await this.planReviewed(request)).phases
  }

  async planReviewed(request: OperationPlanInput) {
    const review = await this.review(request)
    return {
      token: this.planSigner.sign(review),
      phases: review.phases,
      librarySnapshotId: review.librarySnapshotId,
      modelRevision: review.modelRevision,
      localOverlayRevision: review.localOverlayRevision,
    }
  }

  private async review(request: OperationPlanInput): Promise<ReviewedPlan> {
    this.logger.info({ request }, "planning operation")

    const project = await this.database.backend.project.findUnique({
      where: { id: request.projectId },
    })

    if (!project) {
      throw new Error(`Project with ID "${request.projectId}" not found`)
    }

    const catalog = await this.projectLibrary?.catalog(request.projectId)
    const resolved = await this.projectModelService.resolveProject(request.projectId)

    const revision = modelRevision({
      instances: resolved.instances,
      resolvedInputs: resolved.resolvedInputs,
    })

    if (catalog) {
      const database = await this.database.forProject(request.projectId)

      const evaluations = await database.instanceEvaluationState.findMany({
        include: { state: { select: { instanceId: true } } },
      })

      const evaluatedIds = new Set(evaluations.map(state => state.state.instanceId))
      if (
        evaluations.some(
          state =>
            state.librarySnapshotId !== catalog.snapshotId ||
            state.modelRevision !== revision ||
            state.localOverlayRevision !== (catalog.overlay.revision ?? null) ||
            !state.evaluationActionId,
        ) ||
        resolved.instances.some(
          instance => instance.kind === "composite" && !evaluatedIds.has(instance.id),
        )
      ) {
        throw new Error(
          "Composite evaluation is stale; evaluate the current project before planning",
        )
      }
    }

    const context = await OperationContext.load(
      request.projectId,
      this.libraryService,
      this.instanceStateService,
      this.projectModelService,
      undefined,
      this.logger,
      catalog && this.projectLibrary
        ? {
            library: catalog.model,
            snapshotId: catalog.snapshotId,
            projectLibrary: this.projectLibrary,
            modelRevision: revision,
            localOverlayRevision: catalog.overlay.revision ?? null,
          }
        : undefined,
    )

    const options = operationOptionsSchema.parse(request.options ?? {})

    const phases = createOperationPlan(context, request.type, request.instanceIds, options)

    if (
      catalog &&
      (await this.projectLibrary!.catalog(request.projectId)).snapshotId !== catalog.snapshotId
    ) {
      throw new Error("Library snapshot changed during planning")
    }

    const review: ReviewedPlan = {
      projectId: request.projectId,
      type: request.type,
      instanceIds: request.instanceIds,
      options,
      phases,
      librarySnapshotId: catalog?.snapshotId ?? null,
      modelRevision: revision,
      localOverlayRevision: catalog?.overlay.revision ?? null,
      expiresAt: Date.now() + 900_000,
    }

    this.reviewedContexts.set(review, context)
    return review
  }

  /**
   * Launches the project operation.
   *
   * @param request The operation request to launch.
   */
  async launch(request: OperationLaunchInput): Promise<Operation> {
    const options = operationOptionsSchema.parse(request.options ?? {})

    if (request.plan) {
      throw new Error("Client-supplied phases are not accepted; supply a reviewed plan token")
    }

    const current = await this.review(request)

    if (request.planToken) {
      const reviewed = this.planSigner.verify(request.planToken)
      const { expiresAt: _reviewedExpiry, ...reviewedContent } = reviewed
      const { expiresAt: _currentExpiry, ...currentContent } = current

      if (stableJsonStringify(reviewedContent) !== stableJsonStringify(currentContent)) {
        throw new Error("Reviewed plan is stale or does not match the launch request")
      }
    }

    const operation = await this.operationService.createOperation(
      request.projectId,
      request.meta,
      request.type,
      request.instanceIds,
      options,
      { librarySnapshotId: current.librarySnapshotId, phases: current.phases },
    )

    this.logger.info({ operation }, "launching operation")

    const project = await this.database.backend.project.findUnique({
      where: { id: request.projectId },
    })

    if (!project) {
      throw new Error(`Project with ID "${request.projectId}" not found`)
    }

    const catalog = await this.projectLibrary?.catalog(project.id)
    if (
      catalog &&
      (catalog.snapshotId !== current.librarySnapshotId ||
        (catalog.overlay.revision ?? null) !== current.localOverlayRevision)
    ) {
      await this.operationService.markOperationFinished(project.id, operation.id, "failed")
      throw new Error("Library changed before operation launch")
    }

    this.startOperation(project, operation, this.reviewedContexts.get(current))

    return operation
  }

  /**
   * Cancels the current operation.
   * Does nothing if no operation is running.
   */
  cancel(operationId: string, force = false): boolean {
    const runtimeOperation = this.runtimeOperations.get(operationId)
    if (runtimeOperation) {
      return runtimeOperation.cancel(force)
    }

    return false
  }

  cancelInstance(operationId: string, instanceId: InstanceId, force = false): boolean {
    const runtimeOperation = this.runtimeOperations.get(operationId)
    if (runtimeOperation) {
      return runtimeOperation.cancelInstance(instanceId, force)
    }

    return false
  }

  private startOperation(
    project: Project,
    operation: Operation,
    pinnedContext?: OperationContext,
  ): void {
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
      this.libraryService,
      this.projectPortService,
      this.projectLibrary,
      pinnedContext,
    )

    this.runtimeOperations.set(operation.id, runtimeOperation)

    void runtimeOperation.operateSafe().finally(async () => {
      try {
        await this.runnerBackend.finishOperation?.(project.id, operation.id)
      } catch (error) {
        this.logger.warn({ error, operationId: operation.id }, "failed to cleanup runner operation")
      } finally {
        this.runtimeOperations.delete(operation.id)
      }
    })
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

      // step 4: reset attempted instance states
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
