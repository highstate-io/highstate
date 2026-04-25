import type { InstanceId, InstanceModel } from "@highstate/contract"
import type {
  InstanceState,
  OperationOptions,
  OperationPhase,
  OperationPhaseInstance,
  OperationType,
} from "../shared"
import type { OperationContext } from "./operation-context"
import { isVirtualGhostInstance } from "../shared"

type CompositeType = "unknown" | "compositional" | "substantive"
type InclusionReason =
  | "explicit"
  | "dependency"
  | "dependent_cascade"
  | "composite_child"
  | "parent_composite"
  | "ghost_cleanup"

interface WorkState {
  included: Map<InstanceId, InclusionReason>
  compositeTypes: Map<InstanceId, CompositeType>
  pendingWork: Set<InstanceId>
  changed: boolean
  // track relationships for message generation
  dependencyRequiredBy: Map<InstanceId, InstanceId> // dependency -> dependent
  childTriggeringParent: Map<InstanceId, InstanceId> // parent -> child that caused inclusion
  forceFlags: Map<InstanceId, "dependencies" | "children"> // track force reasons
}

export function createOperationPlan(
  context: OperationContext,
  type: OperationType,
  requestedInstanceIds: string[],
  options: OperationOptions,
): OperationPhase[] {
  const enabledGhostStrategies = [
    options.onlyDestroyGhosts,
    options.firstDestroyGhosts,
    options.ignoreGhosts,
  ].filter(Boolean).length

  if (enabledGhostStrategies > 1) {
    throw new Error(
      "Operation options are invalid: only one of onlyDestroyGhosts, firstDestroyGhosts, ignoreGhosts can be enabled.",
    )
  }

  if (type !== "update" && enabledGhostStrategies > 0) {
    throw new Error(
      "Operation options are invalid: onlyDestroyGhosts, firstDestroyGhosts and ignoreGhosts are supported only for update operations.",
    )
  }

  if (options.forceUpdateDependencies && options.ignoreChangedDependencies) {
    throw new Error(
      "Operation options are invalid: forceUpdateDependencies and ignoreChangedDependencies cannot both be enabled.",
    )
  }

  if (options.forceUpdateDependencies && options.ignoreDependencies) {
    throw new Error(
      "Operation options are invalid: forceUpdateDependencies and ignoreDependencies cannot both be enabled.",
    )
  }

  if (options.ignoreChangedDependencies && options.ignoreDependencies) {
    throw new Error(
      "Operation options are invalid: ignoreChangedDependencies and ignoreDependencies cannot both be enabled.",
    )
  }

  if (type === "preview") {
    if (requestedInstanceIds.length !== 1) {
      throw new Error("Preview operations can only target a single instance")
    }

    const instanceId = requestedInstanceIds[0] as InstanceId
    const instance = context.getInstance(instanceId)

    if (instance.kind !== "unit") {
      throw new Error(`Preview is not supported for composite instance "${instanceId}"`)
    }

    return [
      {
        type: "preview",
        instances: [
          {
            id: instanceId,
            parentId: instance.parentId,
            message: "explicitly requested",
          },
        ],
      },
    ]
  }

  // initialize work state
  const workState: WorkState = {
    included: new Map(),
    compositeTypes: new Map(),
    pendingWork: new Set(),
    changed: true,
    dependencyRequiredBy: new Map(),
    childTriggeringParent: new Map(),
    forceFlags: new Map(),
  }

  // seed with explicit requests
  for (const instanceId of requestedInstanceIds) {
    workState.included.set(instanceId as InstanceId, "explicit")
    workState.pendingWork.add(instanceId as InstanceId)
  }

  // work loop - iterate until stabilized
  let iteration = 0
  while (workState.changed && iteration < 100) {
    iteration++
    workState.changed = false

    const workItems = Array.from(workState.pendingWork)
    workState.pendingWork.clear()

    for (const instanceId of workItems) {
      processInstance(instanceId, workState, context, options, type)
    }

    // ensure all instances get at least one chance to be processed
    if (iteration === 1) {
      for (const instanceId of context.getInstanceIds()) {
        if (!workState.pendingWork.has(instanceId) && !workItems.includes(instanceId)) {
          workState.pendingWork.add(instanceId)
          workState.changed = true
        }
      }
    }
  }

  if (iteration >= 100) {
    throw new Error(`Operation plan creation did not converge after 100 iterations`)
  }

  // create ordered phases
  return createOrderedPhases(workState, context, type, options)
}

function processInstance(
  instanceId: InstanceId,
  workState: WorkState,
  context: OperationContext,
  options: OperationOptions,
  operationType: OperationType,
): void {
  const instance =
    operationType === "destroy"
      ? context.tryGetInstanceForDestroy(instanceId)
      : context.tryGetInstance(instanceId)

  if (!instance) {
    throw new Error(`Instance with ID ${instanceId} not found in the operation context`)
  }

  // update composite classification
  updateCompositeClassification(instance, workState, context)

  // apply operation-specific inclusion rules
  if (operationType === "update" || operationType === "preview") {
    processUpdateInclusions(instance, workState, context, options)
  }
  if (operationType === "refresh") {
    processRefreshInclusions(instance, workState, context, options)
  }
  if (operationType === "destroy" || operationType === "recreate") {
    processDestroyInclusions(instance, workState, context, options)
  }

  // propagate to related instances
  propagateToRelated(instance, workState, context)
}

function updateCompositeClassification(
  instance: ReturnType<OperationContext["getInstance"]>,
  workState: WorkState,
  context: OperationContext,
): void {
  if (instance.kind !== "composite") {
    return
  }

  const currentType = workState.compositeTypes.get(instance.id) ?? "unknown"
  let newType: CompositeType = "unknown"
  const inclusionReason = workState.included.get(instance.id)

  // check if explicitly requested
  if (inclusionReason === "explicit") {
    newType = "substantive"
  }

  if (workState.included.has(instance.id) && inclusionReason !== "explicit") {
    // check if any children are included due to external dependencies
    const children = context.getInstanceChildren(instance.id)
    let hasExternalDependencyChildren = false
    for (const child of children) {
      const reason = workState.included.get(child.id)
      if (reason === "dependency" || reason === "dependent_cascade") {
        // check if this dependency is external to this composite
        const requiredBy = workState.dependencyRequiredBy.get(child.id)
        if (requiredBy) {
          const requiredByInstance = context.tryGetInstance(requiredBy)
          if (!requiredByInstance) {
            continue
          }

          // if the requiring instance is not a child of this composite, it's external
          if (requiredByInstance.parentId !== instance.id) {
            hasExternalDependencyChildren = true
            break
          }
        }
      }
    }

    newType = hasExternalDependencyChildren ? "substantive" : "compositional"
  }

  // if classification changed, mark for re-processing
  if (newType !== currentType) {
    workState.compositeTypes.set(instance.id, newType)
    workState.pendingWork.add(instance.id)
    workState.changed = true

    // re-process children when parent classification changes
    const children = context.getInstanceChildren(instance.id)
    for (const child of children) {
      workState.pendingWork.add(child.id)
    }
  }
}

function processUpdateInclusions(
  instance: InstanceModel,
  workState: WorkState,
  context: OperationContext,
  options: OperationOptions,
): void {
  // check if should be included as composite child
  if (instance.parentId) {
    // check if this instance is a descendant of any substantive composite
    const substantiveAncestor = findSubstantiveAncestor(instance.parentId, workState, context)

    if (substantiveAncestor) {
      const isInstanceOutdated = isOutdated(instance, context)
      const shouldInclude =
        options.forceUpdateChildren ||
        (!options.allowPartialCompositeInstanceUpdate && isInstanceOutdated)

      if (shouldInclude && !workState.included.has(instance.id)) {
        const state = context.getState(instance.id)
        if (!isVirtualGhostInstance(state)) {
          include(instance.id, "composite_child", workState, {
            forceFlag: options.forceUpdateChildren ? "children" : undefined,
          })
        }
      }
    }
  }

  // process dependencies if this instance is included
  if (workState.included.has(instance.id)) {
    const dependencies = context.getDependencies(instance.id)
    for (const depInstance of dependencies) {
      if (options.ignoreDependencies) {
        continue
      }

      const dependencyState = context.getState(depInstance.id)

      const shouldInclude =
        options.forceUpdateDependencies ||
        (!options.ignoreChangedDependencies && isOutdated(depInstance, context)) ||
        isFailedOrUndeployedState(dependencyState)

      if (shouldInclude && !workState.included.has(depInstance.id)) {
        include(depInstance.id, "dependency", workState, {
          requiredBy: instance.id,
          forceFlag: options.forceUpdateDependencies ? "dependencies" : undefined,
        })
      }
    }
  }
}

function processRefreshInclusions(
  instance: InstanceModel,
  workState: WorkState,
  context: OperationContext,
  options: OperationOptions,
): void {
  // check if should be included as composite child
  if (instance.parentId) {
    // check if this instance is a descendant of any substantive composite
    const substantiveAncestor = findSubstantiveAncestor(instance.parentId, workState, context)

    if (substantiveAncestor) {
      const isInstanceOutdated = isOutdated(instance, context)
      const shouldInclude =
        options.forceUpdateChildren ||
        (!options.allowPartialCompositeInstanceUpdate && isInstanceOutdated)

      if (shouldInclude && !workState.included.has(instance.id)) {
        include(instance.id, "composite_child", workState, {
          forceFlag: options.forceUpdateChildren ? "children" : undefined,
        })
      }
    }
  }

  // process dependencies if this instance is included
  // key difference: only include dependencies if forced, not if outdated
  if (workState.included.has(instance.id)) {
    const dependencies = context.getDependencies(instance.id)
    for (const depInstance of dependencies) {
      if (options.ignoreDependencies || options.ignoreChangedDependencies) {
        continue
      }

      const shouldInclude = options.forceUpdateDependencies

      if (shouldInclude && !workState.included.has(depInstance.id)) {
        include(depInstance.id, "dependency", workState, {
          requiredBy: instance.id,
          forceFlag: options.forceUpdateDependencies ? "dependencies" : undefined,
        })
      }
    }
  }
}

function isFailedOrUndeployedState(state: InstanceState): boolean {
  return state.status === "failed" || state.status === "undeployed"
}

function processDestroyInclusions(
  instance: InstanceModel,
  workState: WorkState,
  context: OperationContext,
  options: OperationOptions,
): void {
  // check if should be included as composite child
  if (instance.parentId) {
    const parentType = workState.compositeTypes.get(instance.parentId)
    if (parentType === "substantive" && !workState.included.has(instance.id)) {
      // all children of substantive composites being destroyed must be included
      // when partial destruction is disabled
      if (!options.allowPartialCompositeInstanceDestruction) {
        include(instance.id, "composite_child", workState)
      }
    }
  }

  // process dependents if this instance is included and cascade enabled
  if (workState.included.has(instance.id) && options.destroyDependentInstances) {
    const dependentStates = context.getDependentStates(instance.id)

    for (const dependentState of dependentStates) {
      if (!workState.included.has(dependentState.instanceId)) {
        include(dependentState.instanceId, "dependent_cascade", workState, {
          requiredBy: instance.id,
        })
      }
    }
  }
}

function propagateToRelated(
  instance: InstanceModel,
  workState: WorkState,
  context: OperationContext,
): void {
  // propagate upward to parent if instance is included
  if (
    workState.included.has(instance.id) &&
    instance.parentId &&
    context.tryGetInstance(instance.parentId) &&
    !workState.included.has(instance.parentId)
  ) {
    include(instance.parentId, "parent_composite", workState, {
      triggeringChild: instance.id,
    })
  }
}

function findSubstantiveAncestor(
  instanceId: InstanceId,
  workState: WorkState,
  context: OperationContext,
): InstanceId | null {
  let currentId: InstanceId | undefined = instanceId

  // walk up the parent chain looking for a substantive composite
  while (currentId) {
    const compositeType = workState.compositeTypes.get(currentId)
    if (compositeType === "substantive") {
      return currentId
    }

    const instance = context.tryGetInstance(currentId)
    if (!instance) {
      return null
    }

    currentId = instance.parentId
  }

  return null
}

function include(
  instanceId: InstanceId,
  reason: InclusionReason,
  workState: WorkState,
  context?: {
    requiredBy?: InstanceId
    triggeringChild?: InstanceId
    forceFlag?: "dependencies" | "children"
  },
): void {
  const existing = workState.included.get(instanceId)
  if (existing) {
    return
  }

  workState.included.set(instanceId, reason)
  workState.pendingWork.add(instanceId)
  workState.changed = true

  // track relationships for message generation
  if (context?.requiredBy) {
    workState.dependencyRequiredBy.set(instanceId, context.requiredBy)
  }
  if (context?.triggeringChild) {
    workState.childTriggeringParent.set(instanceId, context.triggeringChild)
  }
  if (context?.forceFlag) {
    workState.forceFlags.set(instanceId, context.forceFlag)
  }
}

function createOrderedPhases(
  workState: WorkState,
  context: OperationContext,
  type: OperationType,
  options: OperationOptions,
): OperationPhase[] {
  const phases: OperationPhase[] = []
  const includedIds = Array.from(workState.included.keys())

  if (type === "update" || type === "preview" || type === "refresh") {
    // filter instances that actually need updating
    const instancesNeedingUpdate = includedIds.filter(id => {
      const instance = context.getInstance(id)
      const inclusionReason = workState.included.get(id)

      // always include if outdated or forced
      if (isOutdated(instance, context)) return true
      if (inclusionReason === "dependency" && options.forceUpdateDependencies) return true
      if (inclusionReason === "composite_child" && options.forceUpdateChildren) return true

      // include explicit requests, but composites only if they have non-ghost children
      if (inclusionReason === "explicit") {
        if (instance.kind === "composite") {
          // for composites, only include if they have non-ghost children that need updating
          const children = context.getInstanceChildren(id)
          return children.some(child => {
            if (!workState.included.has(child.id)) return false
            const childState = context.getState(child.id)
            return !isVirtualGhostInstance(childState)
          })
        }
        return true
      }

      // include parent composites only if they have children needing updates
      if (inclusionReason === "parent_composite") {
        const children = context.getInstanceChildren(id)
        return children.some(child => workState.included.has(child.id))
      }

      // include other types (dependency, composite_child, etc.)
      return true
    })

    const updateInstances = topologicalSort(instancesNeedingUpdate, context, false)
      .map(id => createPhaseInstance(id, context, type, workState))
      .filter(inst => inst !== null) as OperationPhaseInstance[]

    const phaseType = type === "refresh" ? "refresh" : "update"
    const updatePhase =
      updateInstances.length > 0 ? ({ type: phaseType, instances: updateInstances } as const) : null

    const ghostDestroyPhase =
      type !== "refresh" && !options.ignoreGhosts
        ? createGhostDestroyPhase(context, includedIds, workState)
        : null

    if (type === "update" && options.onlyDestroyGhosts) {
      if (ghostDestroyPhase) {
        phases.push(ghostDestroyPhase)
      }

      return phases
    }

    if (type === "update" && options.firstDestroyGhosts) {
      if (ghostDestroyPhase) {
        phases.push(ghostDestroyPhase)
      }

      if (updatePhase) {
        phases.push(updatePhase)
      }

      return phases
    }

    if (updatePhase) {
      phases.push(updatePhase)
    }

    if (ghostDestroyPhase) {
      phases.push(ghostDestroyPhase)
    }
  }

  if (type === "destroy") {
    const destroyInstances = topologicalSort(includedIds, context, true)
      .map(id => createPhaseInstance(id, context, type, workState))
      .filter(inst => inst !== null) as OperationPhaseInstance[]

    if (destroyInstances.length > 0) {
      phases.push({ type: "destroy", instances: destroyInstances })
    }
  }

  if (type === "recreate") {
    const destroyInstances = topologicalSort(includedIds, context, true)
      .map(id => createPhaseInstance(id, context, type, workState))
      .filter(inst => inst !== null) as OperationPhaseInstance[]

    const updateInstances = topologicalSort(includedIds, context, false)
      .map(id => createPhaseInstance(id, context, type, workState))
      .filter(inst => inst !== null) as OperationPhaseInstance[]

    if (destroyInstances.length > 0) {
      phases.push({ type: "destroy", instances: destroyInstances })
    }
    if (updateInstances.length > 0) {
      phases.push({ type: "update", instances: updateInstances })
    }
  }

  return phases
}

function createGhostDestroyPhase(
  context: OperationContext,
  includedIds: InstanceId[],
  workState: WorkState,
): OperationPhase | null {
  const compositesNeedingGhostCleanup = new Set<InstanceId>()

  for (const instanceId of includedIds) {
    const instance = context.getInstance(instanceId)
    if (instance.kind !== "composite") continue

    const compositeType = workState.compositeTypes.get(instanceId)
    if (compositeType !== "substantive") continue

    if (hasGhostDescendant(instanceId, context)) {
      compositesNeedingGhostCleanup.add(instanceId)
    }
  }

  const ghostInstances = findGhostCleanup(context, compositesNeedingGhostCleanup)
  if (ghostInstances.length === 0) {
    return null
  }

  const ghostInstanceMap = new Map<InstanceId, OperationPhaseInstance>(
    ghostInstances.map(instance => [instance.id, instance]),
  )

  const sortedGhosts = topologicalSort(
    ghostInstances.map(g => g.id),
    context,
    true,
  )
    .map(id => {
      const ghostInstance = ghostInstanceMap.get(id)

      if (ghostInstance?.message === "ghost cleanup") {
        return ghostInstance
      }

      return createPhaseInstance(id, context, "update", workState)
    })
    .filter((instance): instance is OperationPhaseInstance => instance !== null)

  if (sortedGhosts.length === 0) {
    return null
  }

  return { type: "destroy", instances: sortedGhosts }
}

function hasGhostDescendant(instanceId: InstanceId, context: OperationContext): boolean {
  const queue = context.getInstanceChildren(instanceId).map(child => child.id)

  while (queue.length > 0) {
    const childId = queue.shift()!
    const child = context.getInstance(childId)
    const childState = context.getState(child.id)

    if (isVirtualGhostInstance(childState)) {
      return true
    }

    if (child.kind === "composite") {
      queue.push(...context.getInstanceChildren(child.id).map(instance => instance.id))
    }
  }

  return false
}

function createPhaseInstance(
  instanceId: InstanceId,
  context: OperationContext,
  operationType: OperationType,
  workState?: WorkState,
): OperationPhaseInstance | null {
  const state = context.getState(instanceId)
  const instance =
    operationType === "destroy"
      ? context.tryGetInstanceForDestroy(instanceId)
      : context.tryGetInstance(instanceId)

  if (!instance) {
    return null
  }

  if (
    operationType !== "destroy" &&
    instance.kind === "composite" &&
    !hasUnitDescendant(instanceId, context)
  ) {
    return null
  }

  let message = "included in operation" // fallback

  if (workState) {
    const inclusionReason = workState.included.get(instanceId)
    const requiredBy = workState.dependencyRequiredBy.get(instanceId)
    const triggeringChild = workState.childTriggeringParent.get(instanceId)
    const forceFlag = workState.forceFlags.get(instanceId)
    const instanceState = state

    message = generateContextualMessage(
      context,
      instanceId,
      inclusionReason,
      instanceState,
      requiredBy,
      triggeringChild,
      forceFlag,
    )
  }

  return {
    id: instanceId,
    parentId: instance.parentId ?? state.parentInstanceId ?? undefined,
    message,
  }
}

function hasUnitDescendant(instanceId: InstanceId, context: OperationContext): boolean {
  const queue = context.getInstanceChildren(instanceId).map(child => child.id)
  const visited = new Set<InstanceId>()

  while (queue.length > 0) {
    const childId = queue.pop()!

    if (visited.has(childId)) {
      continue
    }
    visited.add(childId)

    const child = context.getInstance(childId)
    if (child.kind === "unit") {
      return true
    }

    queue.push(...context.getInstanceChildren(childId).map(instance => instance.id))
  }

  return false
}

function generateContextualMessage(
  context: OperationContext,
  instanceId: InstanceId,
  inclusionReason: InclusionReason | undefined,
  instanceState?: InstanceState,
  requiredBy?: InstanceId,
  triggeringChild?: InstanceId,
  forceFlag?: "dependencies" | "children",
): string {
  function getInstanceStateType(
    state?: InstanceState,
  ): "failed" | "undeployed" | "changed" | "up-to-date" {
    if (!state) return "undeployed"
    if (state.status === "failed") return "failed"
    if (state.status === "undeployed") return "undeployed"

    const instance = context.tryGetInstance(instanceId)
    if (!instance) {
      return "up-to-date"
    }

    // composites are containers and cannot be changed/outdated
    if (instance.kind === "composite") {
      return "up-to-date"
    }

    // check if changed by using same logic as isOutdated (for units only)
    const { inputHash: expectedHash } = context.inputHashResolver.requireOutput(instanceId)
    if (state.inputHash !== expectedHash) return "changed"

    return "up-to-date"
  }

  const stateType = getInstanceStateType(instanceState)

  switch (inclusionReason) {
    case "explicit":
      return "explicitly requested"

    case "dependency":
      if (forceFlag === "dependencies") {
        return `required by "${requiredBy}" (forced by options)`
      }
      switch (stateType) {
        case "failed":
          return `failed and required by "${requiredBy}"`
        case "undeployed":
          return `undeployed and required by "${requiredBy}"`
        case "changed":
          return `changed and required by "${requiredBy}"`
        default:
          return `required by "${requiredBy}"`
      }

    case "dependent_cascade":
      return `dependent of destroyed "${requiredBy}"`

    case "composite_child":
      if (forceFlag === "children") {
        return "child of included parent (forced by options)"
      }
      switch (stateType) {
        case "failed":
          return "failed and child of included parent"
        case "undeployed":
          return "undeployed and child of included parent"
        case "changed":
          return "changed and child of included parent"
        default:
          return "child of included parent"
      }

    case "parent_composite":
      return `parent of included child "${triggeringChild}"`

    case "ghost_cleanup":
      return "ghost cleanup"

    default:
      return "included in operation"
  }
}

function findGhostCleanup(
  context: OperationContext,
  compositesNeedingGhostCleanup: Set<InstanceId>,
): OperationPhaseInstance[] {
  const requiredCompositeIds = new Set<InstanceId>()
  const ghostIds = new Set<InstanceId>()

  function collectGhostsInSubtree(rootCompositeId: InstanceId): void {
    const queue: InstanceId[] = [rootCompositeId]

    while (queue.length > 0) {
      const currentId = queue.shift()!
      const children = context.getInstanceChildren(currentId)

      for (const child of children) {
        const childState = context.getState(child.id)

        if (child.kind === "composite") {
          queue.push(child.id)
        }

        if (!isVirtualGhostInstance(childState)) {
          continue
        }

        ghostIds.add(child.id)

        // Include the full composite chain from the ghost parent up to the cleanup root,
        // otherwise destroy-phase parent state recalculation may target non-participating composites.
        let parentId = child.parentId
        while (parentId) {
          const parent = context.tryGetInstance(parentId)
          if (!parent || parent.kind !== "composite") {
            break
          }

          requiredCompositeIds.add(parentId)

          if (parentId === rootCompositeId) {
            break
          }

          parentId = parent.parentId
        }
      }
    }
  }

  for (const instanceId of compositesNeedingGhostCleanup) {
    const instance = context.getInstance(instanceId)
    if (instance.kind !== "composite") continue

    requiredCompositeIds.add(instanceId)
    collectGhostsInSubtree(instanceId)
  }

  const ghosts: OperationPhaseInstance[] = []

  for (const compositeId of requiredCompositeIds) {
    const composite = context.tryGetInstance(compositeId)
    if (!composite) {
      continue
    }

    ghosts.push({
      id: compositeId,
      parentId: composite.parentId,
      message: "included in operation",
    })
  }

  for (const ghostId of ghostIds) {
    const ghost = context.tryGetInstance(ghostId)
    if (!ghost) {
      continue
    }

    ghosts.push({
      id: ghostId,
      parentId: ghost.parentId,
      message: "ghost cleanup",
    })
  }

  return ghosts
}

function isOutdated(instance: InstanceModel, context: OperationContext): boolean {
  // composite instances cannot be outdated - they are containers, not deployable units
  if (instance.kind === "composite") {
    return false
  }

  const state = context.getState(instance.id)

  if (state.status === "failed" || state.status === "undeployed") {
    return true
  }

  // check if input hash has changed by comparing with expected hash from resolver
  const { inputHash: expectedHash } = context.inputHashResolver.requireOutput(instance.id)
  return state.inputHash !== expectedHash
}

function topologicalSort(
  instanceIds: InstanceId[],
  context: OperationContext,
  reverse: boolean,
): InstanceId[] {
  // simple topological sort implementation
  const visited = new Set<InstanceId>()
  const result: InstanceId[] = []
  const visiting = new Set<InstanceId>()

  function visit(instanceId: InstanceId): void {
    if (visiting.has(instanceId)) {
      // circular dependency detected - skip for now
      return
    }
    if (visited.has(instanceId)) {
      return
    }

    visiting.add(instanceId)

    const related = reverse
      ? context.getDependentStates(instanceId).map(state => state.instanceId)
      : context.getDependencies(instanceId).map(dep => dep.id)
    for (const relatedId of related) {
      if (instanceIds.includes(relatedId)) {
        visit(relatedId)
      }
    }

    visiting.delete(instanceId)
    visited.add(instanceId)
    result.push(instanceId)
  }

  for (const instanceId of instanceIds) {
    visit(instanceId)
  }

  return result
}
