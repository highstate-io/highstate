import type {
  InstanceState as BackendInstanceState,
  Operation as BackendOperation,
  OperationPhase as BackendOperationPhase,
  FullProjectModel as BackendProjectModel,
  ProjectOutput,
} from "@highstate/backend/shared"
import { create, fromJson, type JsonValue, toJson } from "@bufbuild/protobuf"
import { type Timestamp, timestampFromDate, ValueSchema } from "@bufbuild/protobuf/wkt"
import {
  type Component,
  ComponentKind,
  ComponentSchema,
  type Entity,
  EntitySchema,
  EvaluationStatus,
  type Hub,
  HubSchema,
  type Instance,
  type InstanceCustomStatus,
  InstanceCustomStatusSchema,
  InstanceOperationStatus,
  InstanceSchema,
  InstanceSource,
  type InstanceState,
  InstanceStateSchema,
  InstanceStatus,
  type Library,
  LibrarySchema,
  type Operation,
  type OperationLog,
  OperationLogSchema,
  type OperationPhase,
  OperationPhaseSchema,
  OperationPhaseType,
  OperationSchema,
  OperationStatus,
  OperationType,
  type Project,
  type ProjectModel,
  ProjectModelSchema,
  ProjectSchema,
} from "@highstate/api/v1"
import {
  instanceCustomStatusInputSchema,
  operationMetaSchema,
  operationOptionsSchema,
  operationPhaseSchema,
} from "@highstate/backend/shared"
import {
  type ComponentModel,
  type EntityModel,
  type HubModel,
  type HubModelPatch,
  type InstanceModel,
  type InstanceModelPatch,
  instanceInputSchema,
  instanceModelSchema,
  z,
} from "@highstate/contract"

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)
const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

export function toProject(project: ProjectOutput): Project {
  return create(ProjectSchema, {
    id: project.id,
    name: project.name,
    meta: project.meta,
    spaceId: project.spaceId,
    modelStorageId: project.modelStorageId,
    libraryId: project.libraryId,
    pulumiBackendId: project.pulumiBackendId,
    createdAt: toTimestamp(project.createdAt),
    updatedAt: toTimestamp(project.updatedAt),
  })
}

export function toProjectModel(model: BackendProjectModel): ProjectModel {
  return create(ProjectModelSchema, {
    instances: [...model.instances, ...model.virtualInstances, ...model.ghostInstances].map(
      toInstance,
    ),
    hubs: model.hubs.map(toHub),
  })
}

export function toInstance(instance: InstanceModel): Instance {
  return create(InstanceSchema, {
    id: instance.id,
    kind: toComponentKind(instance.kind),
    type: instance.type,
    name: instance.name,
    arguments: Object.entries(instance.args ?? {}).map(([key, value]) => ({
      key,
      value: fromJson(ValueSchema, value as JsonValue),
    })),
    inputs: toInstanceReferenceMap(instance.inputs),
    hubInputs: Object.fromEntries(
      Object.entries(instance.hubInputs ?? {}).map(([key, values]) => [
        key,
        { values: values.map(value => ({ hubId: value.hubId })) },
      ]),
    ),
    injectionInputs: (instance.injectionInputs ?? []).map(value => ({ hubId: value.hubId })),
    position: instance.position ?? undefined,
    parentId: instance.parentId,
    outputs: toInstanceReferenceMap(instance.outputs),
    resolvedOutputs: toInstanceReferenceMap(instance.resolvedOutputs),
  })
}

export function fromInstance(instance: Instance): InstanceModel {
  return instanceModelSchema.parse({
    id: instance.id,
    kind: fromComponentKind(instance.kind),
    type: instance.type,
    name: instance.name,
    args: Object.fromEntries(
      instance.arguments.map(argument => [
        argument.key,
        argument.value ? toJson(ValueSchema, argument.value) : null,
      ]),
    ),
    inputs: fromInstanceReferenceMap(instance.inputs),
    hubInputs: Object.fromEntries(
      Object.entries(instance.hubInputs).map(([key, list]) => [
        key,
        list.values.map(value => ({ hubId: value.hubId })),
      ]),
    ),
    injectionInputs: instance.injectionInputs.map(value => ({ hubId: value.hubId })),
    position: instance.position,
  })
}

export function toHub(hub: HubModel): Hub {
  return create(HubSchema, {
    id: hub.id,
    position: hub.position ?? undefined,
    inputs: hub.inputs ?? [],
    injectionInputs: (hub.injectionInputs ?? []).map(value => ({ hubId: value.hubId })),
  })
}

export function fromHub(hub: Hub): HubModel {
  return {
    id: hub.id,
    position: hub.position,
    inputs: hub.inputs.map(fromInstanceReference),
    injectionInputs: hub.injectionInputs.map(value => ({ hubId: value.hubId })),
  }
}

export function toInstancePatch(instance: Instance, paths: readonly string[]): InstanceModelPatch {
  const patch: InstanceModelPatch = {}

  for (const path of paths) {
    switch (path) {
      case "arguments":
        patch.args = Object.fromEntries(
          instance.arguments.map(argument => [
            argument.key,
            argument.value ? toJson(ValueSchema, argument.value) : null,
          ]),
        )
        break
      case "inputs":
        patch.inputs = fromInstanceReferenceMap(instance.inputs)
        break
      case "hub_inputs":
        patch.hubInputs = Object.fromEntries(
          Object.entries(instance.hubInputs).map(([key, list]) => [
            key,
            list.values.map(value => ({ hubId: value.hubId })),
          ]),
        )
        break
      case "injection_inputs":
        patch.injectionInputs = instance.injectionInputs.map(value => ({ hubId: value.hubId }))
        break
      case "position":
        patch.position = instance.position
          ? { x: instance.position.x, y: instance.position.y }
          : null
        break
      case "position.x":
        patch.position = { x: instance.position?.x ?? 0 }
        break
      case "position.y":
        patch.position = { y: instance.position?.y ?? 0 }
        break
    }
  }

  return patch
}

export function toHubPatch(hub: Hub, paths: readonly string[]): HubModelPatch {
  const patch: HubModelPatch = {}

  for (const path of paths) {
    switch (path) {
      case "position":
        patch.position = hub.position ? { x: hub.position.x, y: hub.position.y } : null
        break
      case "position.x":
        patch.position = { x: hub.position?.x ?? 0 }
        break
      case "position.y":
        patch.position = { y: hub.position?.y ?? 0 }
        break
      case "inputs":
        patch.inputs = hub.inputs.map(fromInstanceReference)
        break
      case "injection_inputs":
        patch.injectionInputs = hub.injectionInputs.map(value => ({ hubId: value.hubId }))
        break
    }
  }

  return patch
}

export function toInstanceState(state: BackendInstanceState): InstanceState {
  const model = state.model ? instanceModelSchema.parse(state.model) : undefined

  return create(InstanceStateSchema, {
    id: state.id,
    instanceId: state.instanceId,
    status: toInstanceStatus(state.status),
    source: toInstanceSource(state.source),
    kind: toComponentKind(state.kind),
    parentInstanceId: state.parentInstanceId ?? undefined,
    evaluationState: state.evaluationState
      ? {
          status: toEvaluationStatus(state.evaluationState.status),
          message: state.evaluationState.message ?? undefined,
          model: state.evaluationState.model
            ? toInstance(instanceModelSchema.parse(state.evaluationState.model))
            : undefined,
          evaluatedAt: toTimestamp(state.evaluationState.evaluatedAt),
        }
      : undefined,
    lastOperationState: state.lastOperationState
      ? {
          operationId: state.lastOperationState.operationId,
          stateId: state.lastOperationState.stateId,
          status: toInstanceOperationStatus(state.lastOperationState.status),
          currentResourceCount: state.lastOperationState.currentResourceCount ?? undefined,
          totalResourceCount: state.lastOperationState.totalResourceCount ?? undefined,
          model: toInstance(instanceModelSchema.parse(state.lastOperationState.model)),
          startedAt: toNullableTimestamp(state.lastOperationState.startedAt),
          finishedAt: toNullableTimestamp(state.lastOperationState.finishedAt),
        }
      : undefined,
    terminalIds: state.terminalIds ?? [],
    pageIds: state.pageIds ?? [],
    panelIds: state.panelIds ?? [],
    secretNames: state.secretNames ?? [],
    customStatuses: (state.customStatuses ?? []).map(toInstanceCustomStatus),
    currentResourceCount: state.currentResourceCount ?? undefined,
    hasResourceHooks: state.hasResourceHooks,
    statusFields: state.statusFields
      ? fromJson(ValueSchema, jsonValueSchema.parse(state.statusFields))
      : undefined,
    model: model ? toInstance(model) : undefined,
  })
}

export function toInstanceCustomStatus(
  status: NonNullable<BackendInstanceState["customStatuses"]>[number],
): InstanceCustomStatus {
  const meta = instanceCustomStatusInputSchema.shape.meta.parse(status.meta)

  return create(InstanceCustomStatusSchema, {
    name: status.name,
    meta: {
      title: meta.title ?? status.name,
      description: meta.description,
      icon: meta.icon,
      iconColor: meta.iconColor,
    },
    value: status.value,
    message: status.message ?? undefined,
    order: status.order,
    serviceAccountId: status.serviceAccountId,
    createdAt: toTimestamp(status.createdAt),
    updatedAt: toTimestamp(status.updatedAt),
  })
}

export function toOperation(operation: BackendOperation): Operation {
  const meta = operationMetaSchema.parse(operation.meta)
  const options = operationOptionsSchema.partial().parse(operation.options)
  const phases = operation.phases ? operationPhaseSchema.array().parse(operation.phases) : []

  return create(OperationSchema, {
    id: operation.id,
    meta,
    type: toOperationType(operation.type),
    status: toOperationStatus(operation.status),
    options: {
      forceUpdateDependencies: options.forceUpdateDependencies ?? false,
      ignoreChangedDependencies: options.ignoreChangedDependencies ?? false,
      ignoreDependencies: options.ignoreDependencies ?? false,
      forceUpdateChildren: options.forceUpdateChildren ?? false,
      onlyDestroyGhosts: options.onlyDestroyGhosts ?? false,
      firstDestroyGhosts: options.firstDestroyGhosts ?? false,
      ignoreGhosts: options.ignoreGhosts ?? false,
      destroyDependentInstances: options.destroyDependentInstances ?? false,
      invokeDestroyTriggers: options.invokeDestroyTriggers ?? false,
      deleteUnreachableResources: options.deleteUnreachableResources ?? false,
      forceDeleteState: options.forceDeleteState ?? false,
      allowPartialCompositeInstanceUpdate: options.allowPartialCompositeInstanceUpdate ?? false,
      allowPartialCompositeInstanceDestruction:
        options.allowPartialCompositeInstanceDestruction ?? false,
      refresh: options.refresh ?? false,
      debug: options.debug ?? false,
    },
    requestedInstanceIds: z.string().array().parse(operation.requestedInstanceIds),
    phases: phases.map(toOperationPhase),
    startedAt: toTimestamp(operation.startedAt),
    updatedAt: toTimestamp(operation.updatedAt),
    finishedAt: toNullableTimestamp(operation.finishedAt),
  })
}

export function toOperationPhase(phase: BackendOperationPhase): OperationPhase {
  return create(OperationPhaseSchema, {
    type: toOperationPhaseType(phase.type),
    instances: phase.instances,
  })
}

export function toOperationLog(
  operationId: string,
  log: { id: string; stateId: string | null; content: string; isSystem?: boolean },
): OperationLog {
  return create(OperationLogSchema, {
    id: log.id,
    operationId,
    stateId: log.stateId ?? undefined,
    isSystem: log.isSystem ?? false,
    content: log.content,
  })
}

export function toLibrary(library: {
  components: Record<string, ComponentModel>
  entities: Record<string, EntityModel>
}): Library {
  return create(LibrarySchema, {
    components: Object.fromEntries(
      Object.entries(library.components).map(([type, component]) => [type, toComponent(component)]),
    ),
    entities: Object.fromEntries(
      Object.entries(library.entities).map(([type, entity]) => [type, toEntity(entity)]),
    ),
  })
}

export function toComponent(component: ComponentModel): Component {
  try {
    return create(ComponentSchema, {
      type: component.type,
      kind: toComponentKind(component.kind),
      arguments: Object.fromEntries(
        Object.entries(component.args).map(([name, argument]) => [
          name,
          {
            schema: jsonObjectSchema.parse(argument.schema),
            required: argument.required,
            meta: argument.meta,
          },
        ]),
      ),
      inputs: Object.fromEntries(
        Object.entries(component.inputs).map(([name, port]) => [name, toComponentPort(port)]),
      ),
      outputs: Object.fromEntries(
        Object.entries(component.outputs).map(([name, port]) => [name, toComponentPort(port)]),
      ),
      meta: component.meta,
      definitionHash: component.definitionHash,
    })
  } catch (error) {
    throw new Error(`Failed to convert component "${component.type}" to an API message`, {
      cause: error,
    })
  }
}

export function toEntity(entity: EntityModel): Entity {
  return create(EntitySchema, {
    type: entity.type,
    extensions: entity.extensions ?? [],
    directExtensions: entity.directExtensions ?? [],
    inclusions: entity.inclusions ?? [],
    directInclusions: entity.directInclusions ?? [],
    meta: entity.meta,
    definitionHash: entity.definitionHash,
  })
}

export function toTimestamp(value: Date): Timestamp {
  if (!Number.isFinite(value.getTime())) {
    throw new Error("Cannot convert invalid date to timestamp")
  }

  return timestampFromDate(value)
}

export function toNullableTimestamp(value: Date | null | undefined): Timestamp | undefined {
  return value ? toTimestamp(value) : undefined
}

function toComponentPort(port: ComponentModel["inputs"][string]) {
  return {
    entityType: port.type,
    fromInput: port.fromInput,
    required: port.required,
    multiple: port.multiple,
    meta: port.meta,
  }
}

function toInstanceReferenceMap(values?: InstanceModel["inputs"]) {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, references]) => [
      key,
      {
        values: references,
      },
    ]),
  )
}

function fromInstanceReferenceMap(
  values: Instance["inputs"],
): NonNullable<InstanceModel["inputs"]> {
  return Object.fromEntries(
    Object.entries(values).map(([key, list]) => [key, list.values.map(fromInstanceReference)]),
  )
}

function fromInstanceReference(value: Instance["inputs"][string]["values"][number]) {
  return instanceInputSchema.parse({
    instanceId: value.instanceId,
    output: value.output,
    path: value.path,
  })
}

function toComponentKind(value: string): ComponentKind {
  if (value === "unit") return ComponentKind.UNIT
  if (value === "composite") return ComponentKind.COMPOSITE
  throw new Error(`Unknown component kind "${value}"`)
}

function fromComponentKind(value: ComponentKind): "unit" | "composite" {
  if (value === ComponentKind.UNIT) return "unit"
  if (value === ComponentKind.COMPOSITE) return "composite"
  throw new Error("Component kind must be specified")
}

function toInstanceStatus(value: string): InstanceStatus {
  const statuses = {
    undeployed: InstanceStatus.UNDEPLOYED,
    attempted: InstanceStatus.ATTEMPTED,
    deployed: InstanceStatus.DEPLOYED,
    failed: InstanceStatus.FAILED,
  } as const
  const status = statuses[value as keyof typeof statuses]
  if (status === undefined) throw new Error(`Unknown instance status "${value}"`)
  return status
}

function toInstanceSource(value: string): InstanceSource {
  if (value === "resident") return InstanceSource.RESIDENT
  if (value === "virtual") return InstanceSource.VIRTUAL
  throw new Error(`Unknown instance source "${value}"`)
}

function toEvaluationStatus(value: string): EvaluationStatus {
  if (value === "evaluating") return EvaluationStatus.EVALUATING
  if (value === "evaluated") return EvaluationStatus.EVALUATED
  if (value === "error") return EvaluationStatus.ERROR
  throw new Error(`Unknown evaluation status "${value}"`)
}

function toInstanceOperationStatus(value: string): InstanceOperationStatus {
  const statuses = {
    updating: InstanceOperationStatus.UPDATING,
    processing_triggers: InstanceOperationStatus.PROCESSING_TRIGGERS,
    previewing: InstanceOperationStatus.PREVIEWING,
    destroying: InstanceOperationStatus.DESTROYING,
    refreshing: InstanceOperationStatus.REFRESHING,
    pending: InstanceOperationStatus.PENDING,
    cancelling: InstanceOperationStatus.CANCELLING,
    updated: InstanceOperationStatus.UPDATED,
    previewed: InstanceOperationStatus.PREVIEWED,
    skipped: InstanceOperationStatus.SKIPPED,
    destroyed: InstanceOperationStatus.DESTROYED,
    refreshed: InstanceOperationStatus.REFRESHED,
    cancelled: InstanceOperationStatus.CANCELLED,
    failed: InstanceOperationStatus.FAILED,
  } as const
  const status = statuses[value as keyof typeof statuses]
  if (status === undefined) throw new Error(`Unknown instance operation status "${value}"`)
  return status
}

export function fromOperationType(value: OperationType) {
  if (value === OperationType.UPDATE) return "update"
  if (value === OperationType.PREVIEW) return "preview"
  if (value === OperationType.DESTROY) return "destroy"
  if (value === OperationType.RECREATE) return "recreate"
  if (value === OperationType.REFRESH) return "refresh"
  throw new Error("Operation type must be specified")
}

export function fromOperationPhase(phase: OperationPhase): BackendOperationPhase {
  return operationPhaseSchema.parse({
    type: fromOperationPhaseType(phase.type),
    instances: phase.instances.map(instance => ({
      id: instance.id,
      parentId: instance.parentId,
      message: instance.message,
    })),
  })
}

function toOperationType(value: string): OperationType {
  const types = {
    update: OperationType.UPDATE,
    preview: OperationType.PREVIEW,
    destroy: OperationType.DESTROY,
    recreate: OperationType.RECREATE,
    refresh: OperationType.REFRESH,
  } as const
  const type = types[value as keyof typeof types]
  if (type === undefined) throw new Error(`Unknown operation type "${value}"`)
  return type
}

function toOperationStatus(value: string): OperationStatus {
  const statuses = {
    pending: OperationStatus.PENDING,
    running: OperationStatus.RUNNING,
    failing: OperationStatus.FAILING,
    cancelling: OperationStatus.CANCELLING,
    completed: OperationStatus.COMPLETED,
    failed: OperationStatus.FAILED,
    cancelled: OperationStatus.CANCELLED,
  } as const
  const status = statuses[value as keyof typeof statuses]
  if (status === undefined) throw new Error(`Unknown operation status "${value}"`)
  return status
}

function toOperationPhaseType(value: string): OperationPhaseType {
  const types = {
    destroy: OperationPhaseType.DESTROY,
    preview: OperationPhaseType.PREVIEW,
    update: OperationPhaseType.UPDATE,
    refresh: OperationPhaseType.REFRESH,
  } as const
  const type = types[value as keyof typeof types]
  if (type === undefined) throw new Error(`Unknown operation phase type "${value}"`)
  return type
}

function fromOperationPhaseType(value: OperationPhaseType): BackendOperationPhase["type"] {
  const types = {
    [OperationPhaseType.DESTROY]: "destroy",
    [OperationPhaseType.PREVIEW]: "preview",
    [OperationPhaseType.UPDATE]: "update",
    [OperationPhaseType.REFRESH]: "refresh",
  } as const
  const type = types[value as keyof typeof types]
  if (!type) throw new Error("Operation phase type must be specified")
  return type
}
