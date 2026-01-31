import type { InstanceId, InstanceModel, VersionedName } from "@highstate/contract"
import type { Operation } from "../database"
import type { InstanceState, OperationOptions } from "../shared"
import type { OperationContext } from "./operation-context"
import { getInstanceId } from "@highstate/contract"

type StateType = "upToDate" | "changed" | "error" | "undeployed" | "ghost"

export class PlanTestBuilder {
  private instances = new Map<string, InstanceModel>()
  private dependencies: Array<{ dependent: string; dependency: string }> = []
  private stateMap = new Map<string, InstanceState>()
  private requestedInstanceNames: string[] = []
  private operationType: "update" | "destroy" | "recreate" | "preview" | "refresh" = "update"
  private operationOptions: Partial<OperationOptions> = {}

  constructor(
    private readonly createContext: (
      instances: InstanceModel[],
      states?: InstanceState[],
    ) => Promise<OperationContext>,
    private readonly createTestOperation: (
      type?: "update" | "destroy" | "recreate" | "preview" | "refresh",
      instanceIds?: InstanceId[],
      options?: Partial<OperationOptions>,
    ) => Operation,
  ) {}

  unit(name: string, type: VersionedName = "component.v1") {
    this.instances.set(name, {
      id: getInstanceId(type, name),
      name,
      type,
      kind: "unit",
      parentId: undefined,
      inputs: {},
      args: {},
      outputs: {},
      resolvedInputs: {},
      resolvedOutputs: {},
    })
    return this
  }

  composite(name: string, type: VersionedName = "composite.v1") {
    this.instances.set(name, {
      id: getInstanceId(type, name),
      name,
      type,
      kind: "composite",
      parentId: undefined,
      inputs: {},
      args: {},
      outputs: {},
      resolvedInputs: {},
      resolvedOutputs: {},
    })
    return this
  }

  children(parentName: string, ...childNames: string[]) {
    const parent = this.instances.get(parentName)
    if (!parent) throw new Error(`Parent instance '${parentName}' not found`)

    childNames.forEach(childName => {
      const child = this.instances.get(childName)
      if (!child) throw new Error(`Child instance '${childName}' not found`)
      child.parentId = parent.id
    })
    return this
  }

  depends(dependentName: string, dependencyName: string) {
    this.dependencies.push({ dependent: dependentName, dependency: dependencyName })
    return this
  }

  // set operation type and requested instances
  request(
    operationType: "update" | "destroy" | "recreate" | "preview" | "refresh",
    ...instanceNames: string[]
  ) {
    this.operationType = operationType
    this.requestedInstanceNames = instanceNames
    return this
  }

  // set operation options
  options(options: Partial<OperationOptions>) {
    this.operationOptions = options
    return this
  }

  state(instanceName: string, stateType: StateType) {
    const instance = this.instances.get(instanceName)
    if (!instance) throw new Error(`Instance '${instanceName}' not found`)

    const baseState: InstanceState = {
      id: instance.id,
      instanceId: instance.id,
      status: "undeployed",
      source: stateType === "ghost" ? "virtual" : "resident",
      kind: instance.kind,
      parentId: null,
      parentInstanceId: instance.parentId ?? null,
      selfHash: null,
      inputHash: null,
      outputHash: null,
      dependencyOutputHash: null,
      statusFields: null,
      exportedArtifactIds: null,
      inputHashNonce: null,
      currentResourceCount: null,
      model: null,
      resolvedInputs: null,
      lastOperationState: undefined,
      evaluationState: {} as InstanceState["evaluationState"],
    }

    switch (stateType) {
      case "upToDate": {
        baseState.status = "deployed"
        baseState.inputHash = 12345 // will be updated with actual hash after workset creation
        baseState.lastOperationState = {
          operationId: "test-op",
          stateId: instance.id,
          status: "updated",
          currentResourceCount: null,
          totalResourceCount: null,
          model: instance,
          resolvedInputs: {},
          startedAt: null,
          finishedAt: null,
        }
        break
      }
      case "changed":
        baseState.status = "deployed"
        baseState.inputHash = 99999 // different hash indicates changed state
        baseState.lastOperationState = {
          operationId: "test-op",
          stateId: instance.id,
          status: "updated",
          currentResourceCount: null,
          totalResourceCount: null,
          model: instance,
          resolvedInputs: {},
          startedAt: null,
          finishedAt: null,
        }
        break
      case "error":
        baseState.status = "failed"
        baseState.inputHash = 12345
        baseState.lastOperationState = {
          operationId: "test-op",
          stateId: instance.id,
          status: "updated",
          currentResourceCount: null,
          totalResourceCount: null,
          model: instance,
          resolvedInputs: {},
          startedAt: null,
          finishedAt: null,
        }
        break
      case "undeployed":
        // keep defaults
        break
      case "ghost":
        baseState.status = "deployed"
        baseState.source = "virtual"
        baseState.inputHash = 12345
        baseState.evaluationState = null
        break
    }

    this.stateMap.set(instanceName, baseState)
    return this
  }

  states(stateMap: Record<string, StateType>) {
    Object.entries(stateMap).forEach(([name, type]) => {
      this.state(name, type)
    })
    return this
  }

  async build(): Promise<{
    context: OperationContext
    operation: Operation
  }> {
    // apply dependencies to instance inputs
    this.dependencies.forEach(({ dependent, dependency }) => {
      const depInstance = this.instances.get(dependent)
      const depTarget = this.instances.get(dependency)

      if (!depInstance) throw new Error(`Dependent instance '${dependent}' not found`)
      if (!depTarget) throw new Error(`Dependency instance '${dependency}' not found`)

      // accumulate dependencies instead of overwriting
      const existingDeps = depInstance.inputs?.dependency || []
      depInstance.inputs = {
        ...depInstance.inputs,
        dependency: [...existingDeps, { instanceId: depTarget.id, output: "default" }],
      }
      depInstance.resolvedInputs = depInstance.inputs
    })

    const instances = Array.from(this.instances.values())
    const states = Array.from(this.stateMap.values())

    // get requested instance IDs
    const requestedInstanceIds = this.requestedInstanceNames.map(name => {
      const instance = this.instances.get(name)
      if (!instance) throw new Error(`Requested instance '${name}' not found`)
      return instance.id
    })

    // create operation
    const operation = this.createTestOperation(
      this.operationType,
      requestedInstanceIds,
      this.operationOptions,
    )

    // create context with instances and initial states
    const context = await this.createContext(instances, states)

    // copy resolvedInputs from instances to states for dependency tracking
    states.forEach(state => {
      const instance = instances.find(i => i.id === state.instanceId)
      if (instance?.resolvedInputs) {
        state.resolvedInputs = context.serializeResolvedInputs(instance.resolvedInputs)
      }
    })

    // update "upToDate" states with correct input hashes from context
    const updatedStates = states.map(state => {
      const stateEntry = Array.from(this.stateMap.entries()).find(
        ([, s]) => s.instanceId === state.instanceId,
      )
      if (stateEntry && stateEntry[1] === state) {
        const [instanceName] = stateEntry
        const instance = this.instances.get(instanceName)!

        // if this was marked as upToDate, get the actual input hash from context
        if (state.status === "deployed" && state.inputHash === 12345) {
          try {
            const { inputHash } = context.inputHashResolver.requireOutput(instance.id)
            return { ...state, inputHash }
          } catch {
            // if can't resolve, keep original
            return state
          }
        }
      }
      return state
    })

    // set the corrected states
    context.setStates(updatedStates)

    return { context, operation }
  }
}
