import type { InstanceId } from "@highstate/contract"
import type { InstanceStateService, UpdateOperationStateOptions } from "../business"
import type { InstanceOperationStatus } from "../database"
import type { InstanceStatus, OperationPhase, OperationPhaseType, ProjectOutput } from "../shared"
import type { OperationContext } from "./operation-context"
import { EventEmitter, on } from "node:events"
import { mapValues } from "remeda"

type AbortControllerPair = {
  abortController: AbortController
  forceAbortController: AbortController
}

export class OperationWorkset {
  readonly abortController = new AbortController()
  private readonly forceAbortController = new AbortController()

  readonly instanceAbortControllers = new Map<string, AbortControllerPair>()

  private readonly lockedStateIds = new Set<string>()
  private readonly lockEventEmitter = new EventEmitter()
  private currentPhaseIndex = -1

  currentPhase!: OperationPhaseType
  allAffectedInstanceIds!: ReadonlySet<InstanceId>
  allAffectedStateIds!: ReadonlySet<string>
  phaseAffectedInstanceIds!: ReadonlySet<InstanceId>

  constructor(
    readonly project: ProjectOutput,
    readonly operationId: string,
    readonly phases: OperationPhase[],
    private readonly context: OperationContext,
    private readonly instanceStateService: InstanceStateService,
  ) {
    const affectedInstanceIds = new Set<InstanceId>()
    const affectedStateIds = new Set<string>()

    for (const phase of phases) {
      for (const instance of phase.instances) {
        affectedInstanceIds.add(instance.id)

        const state = this.context.getState(instance.id)
        affectedStateIds.add(state.id)
      }
    }

    this.allAffectedInstanceIds = affectedInstanceIds
    this.allAffectedStateIds = affectedStateIds

    // we will basically create one listener per affected instance
    this.lockEventEmitter.setMaxListeners(this.allAffectedInstanceIds.size)
  }

  hasRemainingPhases(): boolean {
    return this.currentPhaseIndex < this.phases.length - 1
  }

  getLockedStateIds(): Iterable<string> {
    return this.lockedStateIds
  }

  isLastPhaseForInstance(instanceId: InstanceId): boolean {
    if (!this.hasRemainingPhases()) {
      return true
    }

    // TODO: create instance id sets for each phase on initialization to speed this up
    for (let i = this.currentPhaseIndex + 1; i < this.phases.length; i++) {
      if (this.phases[i].instances.find(i => i.id === instanceId)) {
        return false
      }
    }

    return true
  }

  nextPhase(): void {
    if (!this.hasRemainingPhases()) {
      throw new Error("No remaining phases")
    }

    this.currentPhaseIndex++
    this.currentPhase = this.phases[this.currentPhaseIndex].type

    this.phaseAffectedInstanceIds = new Set(
      this.phases[this.currentPhaseIndex].instances.map(i => i.id),
    )
  }

  async waitForInstanceLock(stateId: string, signal: AbortSignal): Promise<void> {
    if (this.lockedStateIds.has(stateId)) {
      return
    }

    for await (const _ of on(this.lockEventEmitter, stateId, { signal })) {
      return
    }
  }

  markInstanceLocked(stateId: string): void {
    this.lockedStateIds.add(stateId)
    this.lockEventEmitter.emit(stateId)
  }

  markInstanceUnlocked(stateId: string): void {
    this.lockedStateIds.delete(stateId)
  }

  async setupOperationStates(): Promise<void> {
    const patches = await this.instanceStateService.createOperationStates(
      this.project.id,
      Array.from(this.allAffectedInstanceIds).map(instanceId => {
        const instance = this.context.getInstance(instanceId)
        const state = this.context.getState(instanceId)

        const resolvedInputs = mapValues(
          //
          this.context.getResolvedInputs(instance.id) ?? {},
          inputs => inputs.map(input => input.input),
        )

        const serializedResolvedInputs = this.context.serializeResolvedInputs(resolvedInputs)

        return [
          {
            stateId: state.id,
            operationId: this.operationId,
            status: "pending",
            model: instance,
            resolvedInputs: serializedResolvedInputs,
          },
          {
            // preview runs still provision a pulumi stack; keep "attempted" so a later destroy removes it
            status: state.status === "undeployed" ? "attempted" : state.status,
            model: instance,
            resolvedInputs: serializedResolvedInputs,
          },
        ]
      }),
    )

    for (const patch of patches) {
      const state = this.context.getState(patch.instanceId!)
      Object.assign(state, patch)
    }
  }

  async updateState(instanceId: InstanceId, options: UpdateOperationStateOptions): Promise<void> {
    const state = this.context.getState(instanceId)

    const patch = await this.instanceStateService.updateOperationState(
      this.project.id,
      state.id,
      this.operationId,
      options,
    )

    if (state.parentInstanceId && this.currentPhase !== "preview") {
      // TODO: update all updates in single transaction
      await this.recalculateCompositeInstanceState(state.parentInstanceId)
    }

    Object.assign(state, patch)
  }

  getAffectedCompositeChildren(instanceId: InstanceId): InstanceId[] {
    if (this.currentPhase === "destroy") {
      // when destroying, only consider children fixed in the state
      return this.context
        .getStateChildIds(instanceId)
        .filter(child => this.phaseAffectedInstanceIds.has(child))
    }

    // for other phases, consider all children defined in the model
    return this.context
      .getInstanceChildren(instanceId)
      .map(child => child.id)
      .filter(childId => this.phaseAffectedInstanceIds.has(childId))
  }

  private async recalculateCompositeInstanceState(instanceId: InstanceId): Promise<void> {
    const state = this.context.getState(instanceId)

    let currentResourceCount = 0
    let totalResourceCount = 0
    let knownTotatalResourceCount = 0

    const children = this.context.getStateChildIds(instanceId)
    for (const childId of children) {
      const child = this.context.getState(childId)

      if (child?.lastOperationState?.currentResourceCount) {
        currentResourceCount += child.lastOperationState.currentResourceCount
      }

      if (child?.lastOperationState?.totalResourceCount) {
        totalResourceCount += child.lastOperationState.totalResourceCount
        knownTotatalResourceCount += 1
      }
    }

    // extrapolate total resource count for other resources without total resource count
    const averageTotalResourceCount =
      knownTotatalResourceCount > 0 ? Math.round(totalResourceCount / knownTotatalResourceCount) : 0

    const notKnownTotalResourceCount = children.length - knownTotatalResourceCount
    totalResourceCount += notKnownTotalResourceCount * averageTotalResourceCount

    const finalTotalResourceCount =
      this.currentPhase === "destroy" && state.lastOperationState?.totalResourceCount
        ? // do not override totalResourceCount with lower values when destroying instances
          Math.min(totalResourceCount, state.lastOperationState.totalResourceCount)
        : totalResourceCount

    await this.updateState(instanceId, {
      operationState: {
        status: this.getTransientStatusByOperationPhase(),
        currentResourceCount,
        totalResourceCount: finalTotalResourceCount,
      },
    })
  }

  getPhaseParentId(instanceId: InstanceId): InstanceId | null {
    if (this.currentPhase === "destroy") {
      // when destroying, only consider parent fixed in the state
      return this.context.getState(instanceId).parentInstanceId ?? null
    }

    // for other phases, consider parent defined in the model
    return this.context.getInstance(instanceId).parentId ?? null
  }

  getTransientStatusByOperationPhase(): InstanceOperationStatus {
    switch (this.currentPhase) {
      case "preview":
        return "previewing"
      case "update":
        return "updating"
      case "destroy":
        return "destroying"
      case "refresh":
        return "refreshing"
    }
  }

  getStableStatusByOperationPhase(): InstanceOperationStatus {
    switch (this.currentPhase) {
      case "preview":
        return "previewed"
      case "update":
        return "updated"
      case "destroy":
        return "destroyed"
      case "refresh":
        return "refreshed"
    }
  }

  getNextStableInstanceStatus(instanceId: InstanceId): InstanceStatus {
    const state = this.context.getState(instanceId)

    switch (this.currentPhase) {
      case "preview":
        return state.status // do not change instance status when previewing
      case "update":
        return "deployed"
      case "destroy":
        return "undeployed"
      case "refresh":
        return state.status // do not change instance status when refreshing
    }
  }

  setupAbortControllersForAllInstances(): void {
    for (const instanceId of this.allAffectedInstanceIds) {
      this.setupInstanceAbortControllers(instanceId)
    }
  }

  private setupInstanceAbortControllers(instanceId: InstanceId): AbortControllerPair {
    const existingPair = this.instanceAbortControllers.get(instanceId)
    if (existingPair) {
      return existingPair
    }

    // create abort controllers and setup them to abort when the operation is aborted
    const abortController = new AbortController()
    this.abortController.signal.addEventListener("abort", () => abortController.abort())

    abortController.signal.addEventListener("abort", () => {
      // notify frontend that the instance is being cancelled
      this.updateState(instanceId, { operationState: { status: "cancelling" } })
    })

    const forceAbortController = new AbortController()
    this.forceAbortController.signal.addEventListener("abort", () => forceAbortController.abort())

    const pair: AbortControllerPair = { abortController, forceAbortController }
    this.instanceAbortControllers.set(instanceId, pair)

    // abort if the parent instance is cancelled
    const children = this.context.getInstanceChildren(instanceId)
    for (const child of children) {
      const childPair = this.setupInstanceAbortControllers(child.id)

      abortController.signal.addEventListener("abort", () => childPair.abortController.abort())

      forceAbortController.signal.addEventListener("abort", () =>
        childPair.forceAbortController.abort(),
      )
    }

    return pair
  }

  cancelInstance(instanceId: InstanceId, allowForceAbort = true): void {
    const abortControllerPair = this.instanceAbortControllers.get(instanceId)
    if (!abortControllerPair) {
      throw new Error(`No abort controller found for instance "${instanceId}"`)
    }

    const { abortController, forceAbortController } = abortControllerPair

    // first try to cancel the operation gracefully

    if (!abortController.signal.aborted) {
      abortController.abort()
      return
    }

    if (!allowForceAbort) {
      return
    }

    // then try to force cancel the operation
    if (!forceAbortController.signal.aborted) {
      forceAbortController.abort()
      return
    }
  }

  cancel(): void {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort()
      return
    }

    // then try to force cancel the operation
    if (!this.forceAbortController.signal.aborted) {
      this.forceAbortController.abort()
      return
    }
  }
}
