import type { Logger } from "pino"
import type { EntitySnapshotService, InstanceStateService, ProjectModelService } from "../business"
import type { LibraryBackend } from "../library"
import {
  type ComponentModel,
  type InstanceId,
  type InstanceInput,
  type InstanceModel,
  isUnitModel,
  type VersionedName,
} from "@highstate/contract"
import { BetterLock } from "better-lock"
import { mapValues, unique } from "remeda"
import {
  type InputHashNode,
  type InputHashOutput,
  InputHashResolver,
  InputResolver,
  type InputResolverNode,
  type InstanceState,
  isTransientInstanceOperationStatus,
  type LibraryModel,
  type ProjectOutput,
  type ResolvedInstanceInput,
  type StableInstanceInput,
} from "../shared"

type RawPulumiOutputs = Record<string, { value: unknown; secret?: boolean }>

export class OperationContext {
  private readonly instanceMap = new Map<InstanceId, InstanceModel>()
  private readonly instanceChildrenMap = new Map<InstanceId, InstanceModel[]>()
  private readonly ghostInstanceIds = new Set<InstanceId>()

  private readonly stateIdMap = new Map<string, InstanceId>()
  private readonly stateMap = new Map<InstanceId, InstanceState>()
  private readonly dependentStateIdMap = new Map<InstanceId, Set<InstanceId>>()
  private readonly stateChildIdMap = new Map<InstanceId, InstanceId[]>()

  public readonly unitSourceHashMap = new Map<string, number>()

  public inputResolver!: InputResolver
  public readonly inputResolverNodes = new Map<string, InputResolverNode>()

  public inputHashResolver!: InputHashResolver
  public readonly inputHashNodes = new Map<string, InputHashNode>()
  private readonly inputHashResolverLock = new BetterLock()

  private readonly resolvedInstanceInputs = new Map<
    string,
    Record<InstanceId, ResolvedInstanceInput[]>
  >()

  private readonly capturedOutputValueMap = new Map<string, Record<string, unknown>[]>()

  private constructor(
    public readonly project: ProjectOutput,
    public readonly library: LibraryModel,
    private readonly logger: Logger,
  ) {}

  public getInstance(instanceId: InstanceId): InstanceModel {
    const instance = this.instanceMap.get(instanceId)
    if (!instance) {
      throw new Error(`Instance with ID ${instanceId} not found in the operation context`)
    }

    return instance
  }

  public isGhostInstance(instanceId: InstanceId): boolean {
    return this.ghostInstanceIds.has(instanceId)
  }

  public getInstanceIds(): IterableIterator<InstanceId> {
    return this.instanceMap.keys()
  }

  public getInstanceChildren(instanceId: InstanceId): InstanceModel[] {
    return this.instanceChildrenMap.get(instanceId) ?? []
  }

  public getStateChildIds(instanceId: InstanceId): InstanceId[] {
    return this.stateChildIdMap.get(instanceId) ?? []
  }

  public getResolvedInputs(
    instanceId: InstanceId,
  ): Record<string, ResolvedInstanceInput[]> | undefined {
    return this.resolvedInstanceInputs.get(instanceId)
  }

  public getCapturedOutputValues(instanceId: InstanceId, output: string): Record<string, unknown>[] {
    const key = `${instanceId}:${output}`
    return this.capturedOutputValueMap.get(key) ?? []
  }

  public updateCapturedOutputValuesFromUnitOutputs(options: {
    instanceId: InstanceId
    instanceType: VersionedName
    outputs: RawPulumiOutputs
  }): void {
    const component = this.library.components[options.instanceType]
    if (!component) {
      return
    }

    for (const [outputName, outputSpec] of Object.entries(component.outputs ?? {})) {
      const raw = options.outputs[outputName]?.value

      if (raw === undefined || raw === null) {
        this.capturedOutputValueMap.set(`${options.instanceId}:${outputName}`, [])
        continue
      }

      const items = outputSpec.multiple ? raw : [raw]
      if (outputSpec.multiple && !Array.isArray(raw)) {
        throw new Error(
          `Output "${outputName}" for instance "${options.instanceId}" must be an array`,
        )
      }

      const values = (items as unknown[]).map(item => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new Error(
            `Output "${outputName}" for instance "${options.instanceId}" must contain objects`,
          )
        }

        return item as Record<string, unknown>
      })

      this.capturedOutputValueMap.set(`${options.instanceId}:${outputName}`, values)
    }
  }

  public setState(state: InstanceState): void {
    this.stateMap.set(state.instanceId, state)
    this.stateIdMap.set(state.id, state.instanceId)

    if (state.parentInstanceId) {
      let children = this.stateChildIdMap.get(state.parentInstanceId)
      if (!children) {
        children = []
        this.stateChildIdMap.set(state.parentInstanceId, children)
      }

      children.push(state.instanceId)
    }

    // traverse resolvedInputs to build dependency relationships
    if (state.resolvedInputs) {
      for (const inputGroup of Object.values(state.resolvedInputs)) {
        for (const input of inputGroup) {
          const instanceId = this.stateIdMap.get(input.stateId)
          if (!instanceId) {
            this.logger.warn(
              `cannot add dependent state for unknown input state ID: ${input.stateId}`,
            )
            continue
          }

          this.addDependentState(state.instanceId, instanceId)
        }
      }
    }
  }

  public serializeResolvedInputs(
    resolvedInputs: Record<string, InstanceInput[]>,
  ): Record<string, StableInstanceInput[]> {
    return mapValues(resolvedInputs, inputs =>
      inputs.map(input => {
        const state = this.getState(input.instanceId)

        return {
          stateId: state.id,
          output: input.output,
        }
      }),
    )
  }

  private addDependentState(instanceId: InstanceId, dependencyId: InstanceId): void {
    let dependentStates = this.dependentStateIdMap.get(dependencyId)

    if (!dependentStates) {
      dependentStates = new Set<InstanceId>()
      this.dependentStateIdMap.set(dependencyId, dependentStates)
    }

    dependentStates.add(instanceId)
  }

  public getState(instanceId: InstanceId): InstanceState {
    const state = this.stateMap.get(instanceId)
    if (!state) {
      throw new Error(`Instance state for "${instanceId}" not found in the operation context`)
    }

    return state
  }

  public getDependentStates(instanceId: InstanceId): InstanceState[] {
    const dependentStateIds = this.dependentStateIdMap.get(instanceId)
    if (!dependentStateIds) {
      return []
    }

    return Array.from(dependentStateIds)
      .map(id => this.stateMap.get(id))
      .filter((state): state is InstanceState => !!state)
  }

  public getDependencies(instanceId: InstanceId): InstanceModel[] {
    const resolvedInputs = this.resolvedInstanceInputs.get(instanceId)
    if (!resolvedInputs) {
      return []
    }

    const dependencies: InstanceModel[] = []

    for (const inputGroup of Object.values(resolvedInputs)) {
      for (const resolvedInput of inputGroup) {
        if (resolvedInput.input.instanceId && resolvedInput.input.instanceId !== instanceId) {
          dependencies.push(this.getInstance(resolvedInput.input.instanceId))
        }
      }
    }

    return dependencies
  }

  private addInstance(instance: InstanceModel, isGhost = false): void {
    if (this.instanceMap.has(instance.id)) {
      throw new Error(`Found multiple instances with the same ID: ${instance.id}`)
    }

    if (!(instance.type in this.library.components)) {
      this.logger.warn(
        `ignoring instance "${instance.id}" because its type "${instance.type}" is not in the library`,
      )
      return
    }

    this.instanceMap.set(instance.id, instance)

    if (isGhost) {
      this.ghostInstanceIds.add(instance.id)
    }

    if (instance.parentId) {
      let children = this.instanceChildrenMap.get(instance.parentId)
      if (!children) {
        children = []
        this.instanceChildrenMap.set(instance.parentId, children)
      }

      children.push(instance)
    }
  }

  private getSourceHashIfApplicable(
    instance: InstanceModel,
    component: ComponentModel,
  ): number | undefined {
    if (isUnitModel(component)) {
      return this.unitSourceHashMap.get(instance.type)
    }

    return undefined
  }

  public getUpToDateInputHashOutput(instance: InstanceModel): Promise<InputHashOutput> {
    return this.inputHashResolverLock.acquire(async () => {
      const component = this.library.components[instance.type]

      this.inputHashNodes.set(instance.id, {
        instance,
        component,
        resolvedInputs: this.resolvedInstanceInputs.get(instance.id)!,
        state: this.stateMap.get(instance.id),
        sourceHash: this.getSourceHashIfApplicable(instance, component),
      })

      this.inputHashResolver.invalidateSingle(instance.id)
      await this.inputHashResolver.process()

      return this.inputHashResolver.requireOutput(instance.id)
    })
  }

  public setStates(states: InstanceState[]): void {
    for (const state of states) {
      this.setState(state)
    }
  }

  private async captureEntitySnapshotsAtOperationStart(options: {
    projectId: string
    captureTime: Date
    entitySnapshotService: EntitySnapshotService
  }): Promise<void> {
    const keys: { stateId: string; output: string; instanceId: InstanceId }[] = []

    for (const [instanceId, inputs] of this.resolvedInstanceInputs.entries()) {
      for (const inputGroup of Object.values(inputs ?? {})) {
        for (const input of inputGroup) {
          if (input.input.instanceId === instanceId) {
            continue
          }

          const dependencyState = this.getState(input.input.instanceId)
          keys.push({
            stateId: dependencyState.id,
            output: input.input.output,
            instanceId: input.input.instanceId,
          })
        }
      }
    }

    if (keys.length === 0) {
      return
    }

    const captured = await options.entitySnapshotService.captureLatestSnapshotValues({
      projectId: options.projectId,
      captureTime: options.captureTime,
      keys: keys.map(k => ({ stateId: k.stateId, output: k.output })),
    })

    for (const key of keys) {
      const snapshotValues = captured.get(`${key.stateId}:${key.output}`) ?? []
      this.capturedOutputValueMap.set(
        `${key.instanceId}:${key.output}`,
        snapshotValues.map(v => v.value),
      )
    }
  }

  getUnfinishedOperationStates(): InstanceState[] {
    const unfinishedStates: InstanceState[] = []
    for (const state of this.stateMap.values()) {
      if (isTransientInstanceOperationStatus(state.lastOperationState?.status)) {
        unfinishedStates.push(state)
      }
    }

    return unfinishedStates
  }

  public static async load(
    projectId: string,
    libraryBackend: LibraryBackend,
    instanceStateService: InstanceStateService,
    projectModelService: ProjectModelService,
    entitySnapshotService: EntitySnapshotService | undefined,
    captureTime: Date | undefined,
    logger: Logger,
  ): Promise<OperationContext> {
    const [{ instances, virtualInstances, hubs, ghostInstances }, project] =
      await projectModelService.getProjectModel(projectId, {
        includeVirtualInstances: true,
        includeGhostInstances: true,
      })

    const [library, states] = await Promise.all([
      libraryBackend.loadLibrary(project.libraryId),
      instanceStateService.getInstanceStates(projectId, {
        includeEvaluationState: true,
        includeParentInstanceId: true,
      }),
    ])

    const context = new OperationContext(
      project,
      library,
      logger.child({ service: "OperationContext" }),
    )

    // prepare instances
    for (const instance of instances) {
      context.addInstance(instance)
    }

    for (const instance of ghostInstances) {
      context.addInstance(instance, true)
    }

    for (const instance of virtualInstances) {
      const contextInstance = context.instanceMap.get(instance.id)

      if (contextInstance) {
        // use evaluated inputs and outputs for real instances from their virtual counterparts
        contextInstance.inputs = instance.resolvedInputs
        contextInstance.outputs = instance.outputs
        contextInstance.resolvedOutputs = instance.resolvedOutputs
      } else if (instance.parentId) {
        // always use resolved inputs for virtual instances
        instance.inputs = instance.resolvedInputs
        context.addInstance(instance)
      } else {
        context.logger.warn(
          `ignoring virtual instance "${instance.id}" because it is not in the project or is not a part of known composite instance`,
        )
      }
    }

    const unitSources = await libraryBackend.getResolvedUnitSources(
      project.libraryId,
      unique(Array.from(context.instanceMap.values()).map(i => i.type)),
    )

    for (const unitSource of unitSources) {
      context.unitSourceHashMap.set(unitSource.unitType, unitSource.sourceHash)
    }

    context.setStates(states)

    // prepare input resolver
    for (const instance of context.instanceMap.values()) {
      context.inputResolverNodes.set(`instance:${instance.id}`, {
        kind: "instance",
        instance,
        component: library.components[instance.type],
      })
    }

    for (const hub of hubs) {
      context.inputResolverNodes.set(`hub:${hub.id}`, { kind: "hub", hub })
    }

    context.inputResolver = new InputResolver(context.inputResolverNodes, logger)
    context.inputResolver.addAllNodesToWorkset()

    await context.inputResolver.process()

    // resolve inputs for all instances and pass outputs to input hash resolver
    for (const instance of context.instanceMap.values()) {
      const output = context.inputResolver.requireOutput(`instance:${instance.id}`)
      if (output.kind !== "instance") {
        throw new Error("Unexpected output kind")
      }

      context.resolvedInstanceInputs.set(instance.id, output.resolvedInputs)

      if (instance.kind === "unit") {
        const component = context.library.components[instance.type]

        context.inputHashNodes.set(instance.id, {
          instance,
          component,
          resolvedInputs: output.resolvedInputs,
          state: context.stateMap.get(instance.id),
          sourceHash: context.getSourceHashIfApplicable(instance, component),
        })
      }
    }

    // prepare input hash resolver
    context.inputHashResolver = new InputHashResolver(context.inputHashNodes, logger)
    context.inputHashResolver.addAllNodesToWorkset()

    await context.inputHashResolver.process()

    if (entitySnapshotService && captureTime) {
      await context.captureEntitySnapshotsAtOperationStart({
        projectId,
        captureTime,
        entitySnapshotService,
      })
    }

    return context
  }
}
