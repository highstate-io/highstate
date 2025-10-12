import type { Logger } from "pino"
import type { ArtifactService } from "../artifact"
import type {
  InstanceLockService,
  InstanceStatePatch,
  InstanceStateService,
  OperationService,
  ProjectModelService,
  SecretService,
  UnitExtraService,
} from "../business"
import type { Operation, OperationUpdateInput, Project } from "../database"
import type { LibraryBackend } from "../library"
import type { RunnerBackend, TypedUnitStateUpdate, UnitStateUpdate } from "../runner"
import {
  type InstanceId,
  type InstanceModel,
  parseInstanceId,
  type TriggerInvocation,
  type UnitConfig,
  type VersionedName,
} from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { mapValues } from "remeda"
import { AbortError, errorToString, isAbortErrorLike, waitForAbort } from "../common"
import {
  type InstanceState,
  isTransientInstanceOperationStatus,
  type OperationPhase,
  PromiseTracker,
  waitAll,
} from "../shared"
import { OperationContext } from "./operation-context"
import { createOperationPlan } from "./operation-plan"
import { OperationWorkset } from "./operation-workset"

export class RuntimeOperation {
  private readonly instancePromiseMap = new Map<InstanceId, Promise<void>>()
  private readonly promiseTracker = new PromiseTracker()

  private workset!: OperationWorkset
  private context!: OperationContext

  private readonly unlockToken = createId()

  constructor(
    private readonly project: Project,
    private readonly operation: Operation,
    private readonly runnerBackend: RunnerBackend,
    private readonly libraryBackend: LibraryBackend,
    private readonly artifactService: ArtifactService,
    private readonly instanceLockService: InstanceLockService,
    private readonly operationService: OperationService,
    private readonly secretService: SecretService,
    private readonly instanceStateService: InstanceStateService,
    private readonly projectModelService: ProjectModelService,
    private readonly unitExtraService: UnitExtraService,
    private readonly logger: Logger,
  ) {}

  cancel(): void {
    this.workset.cancel()
  }

  cancelInstance(instanceId: InstanceId): void {
    this.workset.cancelInstance(instanceId)
  }

  async operateSafe(): Promise<void> {
    try {
      await this.operate()

      // ensure that all promises are resolved
      await this.promiseTracker.waitForAll()
    } catch (error) {
      if (isAbortErrorLike(error)) {
        this.logger.info("the operation was cancelled")

        await this.updateOperation({ status: "cancelled" })
        return
      }

      this.logger.error({ error }, "an error occurred while running the operation")

      await this.updateOperation({ status: "failed" })
      await this.writeOperationLog(errorToString(error))
    } finally {
      try {
        this.promiseTracker.track(this.ensureInstancesUnlocked())
        this.promiseTracker.track(this.ensureOperationStatesFinalized())

        // ensure that all promises are resolved even if the operation failed
        await this.promiseTracker.waitForAll()
      } catch (error) {
        this.logger.error(
          { error },
          "one of the tracked promises failed after the operation failed",
        )
      }
    }
  }

  private async operate(): Promise<void> {
    this.logger.info("starting operation")

    // 1. create the context for the operation
    this.context = await OperationContext.load(
      this.project.id,
      this.libraryBackend,
      this.instanceStateService,
      this.projectModelService,
      this.logger,
    )

    // 2. create the plan for the operation (or use provided one)
    let plan: OperationPhase[]
    if (this.operation.phases) {
      plan = this.operation.phases
    } else {
      plan = createOperationPlan(
        this.context,
        this.operation.type,
        this.operation.requestedInstanceIds,
        this.operation.options,
      )

      // persist the generated plan
      await this.updateOperation({ phases: plan })
    }

    // 3. create the workset to track the state of the operation
    this.workset = new OperationWorkset(
      this.project,
      this.operation.id,
      plan,
      this.context,
      this.instanceStateService,
    )

    // 4. create operation states in datbase for all affected instances in all phases
    await this.workset.setupOperationStates()

    // 5. setup abort controllers for all affected instances in all phases
    this.workset.setupAbortControllersForAllInstances()

    // 6. progressively lock instances and launch them as they get locked
    this.launchLockAcquisitionSequence()

    // 7. run the operation
    await this.processOperation()
  }

  private async updateOperation(patch: OperationUpdateInput): Promise<void> {
    Object.assign(this.operation, patch)
    await this.operationService.updateOperation(this.project.id, this.operation.id, patch)
  }

  private async writeOperationLog(message: string): Promise<void> {
    this.promiseTracker.track(
      this.operationService.appendLog(this.project.id, this.operation.id, null, message),
    )
  }

  private launchLockAcquisitionSequence(): void {
    this.promiseTracker.track(
      this.instanceLockService.lockInstances(
        this.project.id,
        Array.from(this.workset.allAffectedStateIds),
        {
          title: "Operation Lock",
          description: `The instance is locked for the ${this.operation.type} operation "${this.operation.id}".`,
          icon: "mdi:cog-sync",
        },
        async (_tx, newlyLockedStateIds) => {
          // trigger all newly locked instances to start their processing
          for (const stateId of newlyLockedStateIds) {
            this.workset.markInstanceLocked(stateId)
          }
        },
        true, // allow partial locks to allow independent free branches to run
        this.workset.abortController.signal,
        60_000, // wait up to 60 seconds for unlock events before retrying
        this.unlockToken,
      ),
    )
  }

  private async processOperation(): Promise<void> {
    const errors: string[] = []

    while (this.workset.hasRemainingPhases()) {
      this.workset.nextPhase()
      this.instancePromiseMap.clear()

      // lauch all instances in this phase
      for (const instanceId of this.workset.phaseAffectedInstanceIds) {
        const instance = this.context.getInstance(instanceId)
        const state = this.context.getState(instanceId)
        const promise = this.getInstancePromiseForOperation(instance, state)

        this.instancePromiseMap.set(instanceId, promise)
        this.promiseTracker.track(promise)
      }

      // wait for all instances in this phase to complete
      await this.promiseTracker.waitForAll()

      this.logger.info(`phase "%s" completed`, this.workset.currentPhase)
    }

    if (errors.length > 0) {
      this.operation.status = "failed"

      this.operationService.appendLog(
        this.project.id,
        this.operation.id,
        null,
        `Operation failed with the following errors:\n${errors.join("\n")}`,
      )
    } else {
      this.operation.status = "completed"
    }

    await this.operationService.markOperationFinished(
      this.project.id,
      this.operation.id,
      this.operation.status,
    )

    this.logger.info("operation completed")
  }

  private getInstancePromiseForOperation(
    instance: InstanceModel,
    state: InstanceState,
  ): Promise<void> {
    if (instance.kind === "unit") {
      return this.getUnitPromise(instance, state)
    }

    return this.getCompositePromise(instance)
  }

  private getUnitPromise(instance: InstanceModel, state: InstanceState): Promise<void> {
    switch (this.workset.currentPhase) {
      case "update": {
        return this.updateUnit(instance, state)
      }
      case "destroy": {
        return this.destroyUnit(instance, state)
      }
      case "refresh": {
        return this.refreshUnit(instance, state)
      }
      case "preview": {
        return this.previewUnit(instance, state)
      }
    }
  }

  private previewUnit(instance: InstanceModel, state: InstanceState): Promise<void> {
    return this.getInstancePromise(instance.id, async (logger, signal, forceSignal) => {
      signal.throwIfAborted()

      if (this.operation.status === "failing") {
        throw new AbortError("The operation is failing, aborting preview branch")
      }

      logger.info("previewing unit")

      await this.workset.updateState(instance.id, {
        operationState: {
          status: "previewing",
          startedAt: new Date(),
        },
      })

      signal.throwIfAborted()

      const secrets = await this.secretService.getInstanceSecretValues(this.project.id, state.id)
      signal.throwIfAborted()

      const config = this.prepareUnitConfig(instance, secrets)
      const artifactIds = this.collectArtifactIdsForInstance(instance)
      const artifacts = await this.artifactService.getArtifactsByIds(this.project.id, artifactIds)

      logger.debug({ count: artifactIds.length }, "artifact ids collected for preview")

      await this.runnerBackend.preview({
        projectId: this.project.id,
        libraryId: this.project.libraryId,
        stateId: state.id,
        instanceType: instance.type,
        instanceName: instance.name,
        config,
        refresh: this.operation.options.refresh,
        secrets,
        artifacts,
        signal,
        forceSignal,
        debug: this.operation.options.debug,
      })

      await this.watchStateStream(state, instance.type, instance.name, logger)
      logger.info("unit preview completed")
    })
  }

  private getCompositePromise(instance: InstanceModel): Promise<void> {
    return this.getInstancePromise(instance.id, async logger => {
      let instanceState: InstanceStatePatch | undefined

      // set parent ID on update operation
      if (this.workset.currentPhase === "update") {
        if (instance.parentId) {
          const parentState = this.context.getState(instance.parentId)
          instanceState = { parentId: parentState.id }
        } else {
          instanceState = { parentId: null }
        }
      }

      await this.workset.updateState(instance.id, {
        operationState: {
          status: this.workset.getTransientStatusByOperationPhase(),
          startedAt: new Date(),
        },
        instanceState,
      })

      const children = this.workset.getAffectedCompositeChildren(instance.id)
      const childPromises: Promise<void>[] = []

      if (children.length) {
        logger.info("running %s children", children.length)
      } else {
        logger.warn("no affected children found for composite component")
      }

      for (const child of children) {
        logger.debug(`waiting for child "%s"`, child)

        const instance = this.context.getInstance(child)
        const state = this.context.getState(child)
        const promise = this.getInstancePromiseForOperation(instance, state)

        childPromises.push(promise)
      }

      await waitAll(childPromises)

      logger.debug("all children completed")

      // update the instance and operation state after all children are completed in last phase
      if (this.workset.isLastPhaseForInstance(instance.id)) {
        await this.workset.updateState(instance.id, {
          operationState: {
            status: this.workset.getStableStatusByOperationPhase(),
            finishedAt: new Date(),
          },
          instanceState: {
            status: this.workset.getNextStableInstanceStatus(instance.id),
          },
        })
      }
    })
  }

  private updateUnit(instance: InstanceModel, state: InstanceState): Promise<void> {
    return this.getInstancePromise(instance.id, async (logger, signal, forceSignal) => {
      await Promise.race([
        this.updateUnitDependencies(instance.id, logger),

        // to immediately abort the operation if requested
        waitForAbort(signal),
      ])

      signal.throwIfAborted()

      if (this.operation.status === "failing") {
        throw new AbortError("The operation is failing, aborting current branch (still not failed)")
      }

      logger.info("updating unit")

      await this.workset.updateState(instance.id, {
        operationState: {
          status: "updating",
          startedAt: new Date(),
        },
      })

      signal.throwIfAborted()

      const secrets = await this.secretService.getInstanceSecretValues(this.project.id, state.id)

      signal.throwIfAborted()

      const config = this.prepareUnitConfig(instance, secrets)

      // collect artifacts authorized for this instance
      const artifactIds = this.collectArtifactIdsForInstance(instance)
      const artifacts = await this.artifactService.getArtifactsByIds(this.project.id, artifactIds)

      logger.debug({ count: artifactIds.length }, "artifact ids collected from dependencies")

      await this.runnerBackend.update({
        projectId: this.project.id,
        libraryId: this.project.libraryId,
        stateId: state.id,
        instanceType: instance.type,
        instanceName: instance.name,
        config,
        refresh: this.operation.options.refresh,
        secrets,
        artifacts,
        signal,
        forceSignal,
        debug: this.operation.options.debug,
      })

      await this.watchStateStream(state, instance.type, instance.name, logger)
      logger.info("unit updated")
    })
  }

  private async updateUnitDependencies(instanceId: InstanceId, logger: Logger): Promise<void> {
    try {
      const dependencies = this.context.getDependencies(instanceId)
      const dependencyPromises: Promise<void>[] = []

      for (const dependency of dependencies) {
        if (!this.workset.phaseAffectedInstanceIds.has(dependency.id)) {
          // skip dependencies that are not affected by the operation
          continue
        }

        const state = this.context.getState(dependency.id)

        logger.debug(`waiting for dependency "%s"`, dependency.id)
        dependencyPromises.push(this.getInstancePromiseForOperation(dependency, state))
      }

      await waitAll(dependencyPromises)

      if (dependencies.length > 0) {
        logger.info("all dependencies completed")
      }
    } catch (error) {
      // abort the instance if any dependency fails
      throw new AbortError("One of the dependencies failed", { cause: error })
    }
  }

  private async processBeforeDestroyTriggers(
    instance: InstanceModel,
    state: InstanceState,
    logger: Logger,
    signal: AbortSignal,
    forceSignal: AbortSignal,
  ): Promise<void> {
    if (!this.operation.options.invokeDestroyTriggers) {
      logger.debug("destroy triggers are disabled for the operation")
      return
    }

    const allTriggers = await this.unitExtraService.getInstanceTriggers(this.project.id, state.id)

    const beforeDestroyTriggers = allTriggers.filter(
      trigger => trigger.spec.type === "before-destroy",
    )

    if (beforeDestroyTriggers.length === 0) {
      return
    }

    const invokedTriggers = beforeDestroyTriggers.map(trigger => ({
      name: trigger.name,
    }))

    await this.workset.updateState(instance.id, {
      operationState: { status: "processing_triggers" },
    })

    logger.info("updating unit to process before-destroy triggers...")

    const secrets = await this.secretService.getInstanceSecretValues(this.project.id, state.id)

    await this.runnerBackend.update({
      projectId: this.project.id,
      stateId: state.id,
      libraryId: this.project.libraryId,
      instanceType: instance.type,
      instanceName: instance.name,
      config: this.prepareUnitConfig(instance, secrets, invokedTriggers),
      refresh: this.operation.options.refresh,
      secrets,
      signal,
      forceSignal,
      debug: this.operation.options.debug,
    })

    logger.debug("unit update requested")

    await this.watchStateStream(state, instance.type, instance.name, logger)
    logger.debug("before-destroy triggers processed")
  }

  private async destroyUnit(instance: InstanceModel, state: InstanceState): Promise<void> {
    return this.getInstancePromise(instance.id, async (logger, signal, forceSignal) => {
      const dependentPromises: Promise<void>[] = []
      const dependents = this.context.getDependentStates(instance.id)

      for (const dependent of dependents) {
        if (!this.workset.phaseAffectedInstanceIds.has(dependent.instanceId)) {
          // skip dependents that are not affected by the operation
          continue
        }

        const instance = this.context.getInstance(dependent.instanceId)
        dependentPromises.push(this.getInstancePromiseForOperation(instance, dependent))
      }

      await Promise.race([
        waitAll(dependentPromises),

        // to immediately abort the operation if requested
        waitForAbort(signal),
      ])

      signal.throwIfAborted()

      if (this.operation.status === "failing") {
        throw new AbortError("The operation is failing, aborting current branch (still not failed)")
      }

      await this.processBeforeDestroyTriggers(instance, state, logger, signal, forceSignal)
      signal.throwIfAborted()

      logger.info("destroying unit...")

      await this.workset.updateState(instance.id, {
        operationState: {
          status: "destroying",
          startedAt: new Date(),
        },
      })

      const [type, name] = parseInstanceId(instance.id)

      await this.runnerBackend.destroy({
        projectId: this.project.id,
        stateId: state.id,
        libraryId: this.project.libraryId,
        instanceType: type,
        instanceName: name,
        refresh: this.operation.options.refresh,
        signal,
        forceSignal,
        deleteUnreachable: this.operation.options.deleteUnreachableResources,
        forceDeleteState: this.operation.options.forceDeleteState,
        debug: this.operation.options.debug,
      })

      logger.debug("destroy request sent")

      await this.watchStateStream(state, type, name, logger)

      logger.info("unit destroyed")
    })
  }

  private async refreshUnit(instance: InstanceModel, state: InstanceState): Promise<void> {
    return this.getInstancePromise(instance.id, async (logger, signal, forceSignal) => {
      await this.workset.updateState(instance.id, {
        operationState: {
          status: "refreshing",
          startedAt: new Date(),
        },
      })

      logger.info("refreshing unit...")

      const [type, name] = parseInstanceId(instance.id)

      await this.runnerBackend.refresh({
        projectId: this.project.id,
        stateId: state.id,
        libraryId: this.project.libraryId,
        instanceType: type,
        instanceName: name,
        signal,
        forceSignal,
        debug: this.operation.options.debug,
      })

      logger.debug("unit refresh requested")

      await this.watchStateStream(state, type, name, logger)
      logger.info("unit refreshed")
    })
  }

  private async watchStateStream(
    state: InstanceState,
    instanceType: VersionedName,
    instanceName: string,
    logger: Logger,
  ): Promise<void> {
    const stream = this.runnerBackend.watch({
      projectId: this.project.id,
      stateId: state.id,
      libraryId: this.project.libraryId,
      instanceType,
      instanceName,
      debug: this.operation.options.debug,
    })

    let update: UnitStateUpdate | undefined

    for await (update of stream) {
      try {
        await this.handleUnitStateUpdate(update, state)
      } catch (error) {
        logger.error({ error }, "failed to handle unit state update")
      }

      if (update.type === "error") {
        // rethrow the error to stop the execution of dependent units
        throw new Error(
          `An error occurred while processing the unit "${update.unitId}": ${update.message}`,
        )
      }

      if (update.type === "completion") {
        return
      }
    }

    throw new Error(
      "The unit state stream was closed without a completion update or it was not handled properly.",
    )
  }

  private prepareUnitConfig(
    instance: InstanceModel,
    secrets: Record<string, unknown>,
    invokedTriggers: TriggerInvocation[] = [],
  ): UnitConfig {
    const resolvedInputs = this.context.getResolvedInputs(instance.id)

    return {
      instanceId: instance.id,
      args: instance.args ?? {},
      inputs: mapValues(resolvedInputs ?? {}, input => input.map(value => value.input)),
      invokedTriggers,
      secretNames: Object.keys(secrets),
      stateIdMap: this.context.getInstanceIdToStateIdMap(instance.id),
    }
  }

  private async handleUnitStateUpdate(
    update: UnitStateUpdate,
    state: InstanceState,
  ): Promise<void> {
    switch (update.type) {
      case "message":
        this.handleUnitMessage(update, state)
        return
      case "progress":
        await this.handleUnitProgress(update)
        return
      case "error":
        await this.handleUnitError(update, state)
        return
      case "completion":
        await this.handleUnitCompletion(update, state)
        return
    }
  }

  private handleUnitMessage(update: TypedUnitStateUpdate<"message">, state: InstanceState): void {
    this.operationService.appendLog(this.project.id, this.operation.id, state.id, update.message)
  }

  private async handleUnitProgress(update: TypedUnitStateUpdate<"progress">): Promise<void> {
    await this.workset.updateState(update.unitId, {
      operationState: {
        currentResourceCount: update.currentResourceCount,
        totalResourceCount: update.totalResourceCount,
      },
    })
  }

  private async handleUnitError(
    update: TypedUnitStateUpdate<"error">,
    state: InstanceState,
  ): Promise<void> {
    await this.workset.updateState(update.unitId, {
      instanceState:
        this.operation.type === "preview"
          ? // do not change instance status in preview mode
            undefined
          : {
              // keep "deployed" status for initially deployed instances even if the operation was failed or cancelled
              status: state.status === "deployed" ? "deployed" : "failed",
            },
      operationState: {
        status: isAbortErrorLike(update.message) ? "cancelled" : "failed",
        finishedAt: new Date(),
      },
    })
  }

  private async handleUnitCompletion(
    update: TypedUnitStateUpdate<"completion">,
    state: InstanceState,
  ): Promise<void> {
    if (this.operation.type === "preview") {
      await this.workset.updateState(update.unitId, {
        operationState: {
          status: this.workset.getStableStatusByOperationPhase(),
          finishedAt: new Date(),
        },
      })
      return
    }

    const instance = this.context.getInstance(update.unitId)

    const data: InstanceStatePatch = {
      status: this.workset.getNextStableInstanceStatus(instance.id),
      statusFields: update.statusFields ?? null,
    }

    const artifactIds = update.exportedArtifactIds
      ? Object.values(update.exportedArtifactIds).flat()
      : []

    if (update.operationType !== "destroy") {
      // давайте еще больше усложним и без того сложную штуку
      // set output hash before calculating input hash to capture up-to-date output hash for dependencies
      state.outputHash = update.outputHash ?? null

      // recalculate the input and output hashes for the instance
      const { inputHash, dependencyOutputHash } =
        await this.context.getUpToDateInputHashOutput(instance)

      data.inputHash = inputHash
      data.dependencyOutputHash = dependencyOutputHash
      data.outputHash = update.outputHash

      data.exportedArtifactIds = update.exportedArtifactIds

      // also update the parent ID
      if (instance.parentId) {
        const parentState = this.context.getState(instance.parentId)
        data.parentId = parentState.id
      } else {
        data.parentId = null
      }
    } else {
      data.inputHash = null
      data.dependencyOutputHash = null
      data.outputHash = null
      data.parentId = null
      data.model = null
      data.resolvedInputs = null
      data.exportedArtifactIds = null
    }

    // update the operation state
    await this.workset.updateState(instance.id, {
      // TODO: honestly, it is not correct
      // may be we should track operation phases separately
      // or introduce status like "destroyed-before-recreation" (quite ugly though)
      operationState: {
        status: this.workset.getStableStatusByOperationPhase(),
        finishedAt: new Date(),
      },

      // do not write instance state for non-last phases of the instance
      instanceState: this.workset.isLastPhaseForInstance(instance.id) ? data : undefined,

      // also do not write unit extra data for non-last phases of the instance
      unitExtra: this.workset.isLastPhaseForInstance(instance.id)
        ? {
            pages: update.pages ?? [],
            terminals: update.terminals ?? [],
            triggers: update.triggers ?? [],
            workers: update.workers ?? [],
            secrets: update.secrets ?? {},
            artifactIds,
          }
        : undefined,
    })

    if (
      update.operationType === "destroy" &&
      this.workset.isLastPhaseForInstance(instance.id) &&
      this.context.isGhostInstance(instance.id)
    ) {
      this.instanceStateService.publishGhostInstanceDeletion(this.project.id, [instance.id])
    }
  }

  private getInstancePromise(
    instanceId: InstanceId,
    fn: (logger: Logger, signal: AbortSignal, forceSignal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    let instancePromise = this.instancePromiseMap.get(instanceId)
    if (instancePromise) {
      return instancePromise
    }

    // "pending" -> "running" if at least one instance is running
    if (this.operation.status === "pending") {
      this.operation.status = "running"
      this.promiseTracker.track(this.updateOperation({ status: this.operation.status }))
    }

    const state = this.context.getState(instanceId)

    const logger = this.logger.child({ instanceId }, { msgPrefix: `[${instanceId}] ` })
    const abortControllerPair = this.workset.instanceAbortControllers.get(instanceId)
    if (!abortControllerPair) {
      throw new Error(`Abort controllers for instance "${instanceId}" are not initialized`)
    }

    const { abortController, forceAbortController } = abortControllerPair

    instancePromise = this.workset
      .waitForInstanceLock(state.id, abortController.signal)
      .then(() => fn(logger, abortController.signal, forceAbortController.signal))
      .catch(error => {
        if (this.operation.status !== "failing") {
          // report the failing status of the operation
          this.operation.status = "failing"
          this.promiseTracker.track(this.updateOperation({ status: this.operation.status }))
        }

        if (isTransientInstanceOperationStatus(state.lastOperationState?.status)) {
          // if the underlying method did not correctly update the instance status, do it here
          this.promiseTracker.track(
            this.workset.updateState(instanceId, {
              operationState: {
                status: isAbortErrorLike(error) ? "cancelled" : "failed",
                finishedAt: new Date(),
              },
              instanceState: {
                // keep "deployed" status for initially deployed instances even if the operation was failed or cancelled
                status: state.status === "deployed" ? "deployed" : "failed",
              },
            }),
          )

          this.promiseTracker.track(
            this.operationService.appendLog(
              this.project.id,
              this.operation.id,
              state.id,
              errorToString(error),
            ),
          )
        }

        // rethrow the error
        throw error
      })
      .finally(() => {
        if (!this.workset.isLastPhaseForInstance(instanceId)) {
          // do not finalize the instance if it has more phases to run
          return
        }

        this.instancePromiseMap.delete(instanceId)

        // TODO: ideally we should defer unlocking until all direct dependents are completed,
        // to ensure that they are received expected inputs from this instance
        this.promiseTracker.track(
          this.instanceLockService
            .unlockInstances(this.project.id, [state.id], this.unlockToken)
            .then(() => this.workset.markInstanceUnlocked(state.id)),
        )

        this.logger.debug(`promise for instance "%s" completed`, instanceId)
      })

    this.instancePromiseMap.set(instanceId, instancePromise)
    this.logger.trace(`created new promise for instance "%s"`, instanceId)

    return instancePromise
  }

  private async ensureInstancesUnlocked(): Promise<void> {
    const lockedStateIds = Array.from(this.workset.getLockedStateIds())
    if (lockedStateIds.length === 0) {
      return
    }

    this.logger.warn("unlocking %d locked instances before shutting down", lockedStateIds.length)

    await this.instanceLockService.unlockInstances(
      this.project.id,
      lockedStateIds,
      this.unlockToken,
    )
  }

  private async ensureOperationStatesFinalized(): Promise<void> {
    const unfinishedStates = this.context.getUnfinishedOperationStates()
    if (unfinishedStates.length === 0) {
      return
    }

    this.logger.warn(
      "finalizing %d unfinished operation states before shutting down",
      unfinishedStates.length,
    )

    for (const state of unfinishedStates) {
      await this.workset.updateState(state.instanceId, {
        operationState: {
          status: "failed",
          finishedAt: new Date(),
        },
        instanceState: {
          status: state.status === "deployed" ? "deployed" : "failed",
        },
      })
    }
  }

  /**
   * Collects artifact IDs from dependencies based on the direct connections
   * from instance inputs to dependency outputs.
   */
  private collectArtifactIdsForInstance(instance: InstanceModel): string[] {
    const artifactIds = new Set<string>()
    const instanceInputs = this.context.getResolvedInputs(instance.id) ?? {}

    for (const inputs of Object.values(instanceInputs)) {
      for (const input of inputs) {
        const dependencyState = this.context.getState(input.input.instanceId)
        if (!dependencyState.exportedArtifactIds) {
          continue
        }

        const outputKey = input.input.output
        const outputArtifactIds = dependencyState.exportedArtifactIds[outputKey]
        if (!outputArtifactIds) {
          continue
        }

        for (const hash of outputArtifactIds) {
          artifactIds.add(hash)
        }
      }
    }

    return Array.from(artifactIds)
  }
}
