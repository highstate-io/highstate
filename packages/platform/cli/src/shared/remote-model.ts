import { create, fromJson, type JsonValue, toJson } from "@bufbuild/protobuf"
import { ValueSchema } from "@bufbuild/protobuf/wkt"
import {
  ComponentArgumentMapEntrySchema,
  ComponentKind,
  type Hub,
  HubReferenceListSchema,
  HubReferenceSchema,
  HubSchema,
  type Instance,
  InstanceArgumentPatchOperation_Operation,
  InstanceArgumentPatchOperationSchema,
  InstanceReferenceListSchema,
  InstanceReferenceSchema,
  InstanceSchema,
  OperationOptionsSchema,
  type OperationPhase,
  OperationPhaseSchema,
  OperationType,
  PositionSchema,
} from "@highstate/api/v1"
import { z } from "zod"

const referenceSchema = z.object({
  instance_id: z.string().min(1),
  output: z.string().min(1),
  path: z.string().min(1).optional(),
})
const hubReferenceSchema = z.object({ hub_id: z.string().min(1) })
const positionSchema = z.object({ x: z.number(), y: z.number() })
const instanceFields = {
  args: z.record(z.string(), z.json()).optional(),
  inputs: z.record(z.string(), z.array(referenceSchema)).optional(),
  hub_inputs: z.record(z.string(), z.array(hubReferenceSchema)).optional(),
  injection_inputs: z.array(hubReferenceSchema).optional(),
  position: positionSchema.partial().nullable().optional(),
}
export const instanceInputSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["unit", "composite"]),
  type: z.string().min(1),
  name: z.string().min(1),
  ...instanceFields,
})
export const instancePatchSchema = z.object(instanceFields)
export const hubInputSchema = z.object({
  id: z.string().min(1),
  inputs: z.array(referenceSchema).optional(),
  injection_inputs: z.array(hubReferenceSchema).optional(),
  position: positionSchema.optional(),
})
export const hubPatchSchema = z.object({
  inputs: z.array(referenceSchema).optional(),
  injection_inputs: z.array(hubReferenceSchema).optional(),
  position: positionSchema.partial().nullable().optional(),
})
export const nodesInputSchema = z.object({
  instances: z.array(instanceInputSchema).default([]),
  hubs: z.array(hubInputSchema).default([]),
})

export const argumentPatchSchema = z.array(
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("add"), path: z.string(), value: z.json() }),
    z.object({ op: z.literal("replace"), path: z.string(), value: z.json() }),
    z.object({ op: z.literal("remove"), path: z.string() }),
    z.object({ op: z.literal("test"), path: z.string(), value: z.json() }),
  ]),
)

export type ArgumentPatch = z.infer<typeof argumentPatchSchema>[number]

export function toArgumentPatchOperation(operation: ArgumentPatch) {
  return create(InstanceArgumentPatchOperationSchema, {
    operation: {
      add: InstanceArgumentPatchOperation_Operation.ADD,
      replace: InstanceArgumentPatchOperation_Operation.REPLACE,
      remove: InstanceArgumentPatchOperation_Operation.REMOVE,
      test: InstanceArgumentPatchOperation_Operation.TEST,
    }[operation.op],
    path: operation.path,
    value: operation.op === "remove" ? undefined : fromJson(ValueSchema, operation.value),
  })
}

export function toInstance(input: z.infer<typeof instanceInputSchema>): Instance {
  return create(InstanceSchema, {
    id: input.id,
    kind: input.kind === "unit" ? ComponentKind.UNIT : ComponentKind.COMPOSITE,
    type: input.type,
    name: input.name,
    arguments: Object.entries(input.args ?? {}).map(([key, value]) =>
      create(ComponentArgumentMapEntrySchema, { key, value: fromJson(ValueSchema, value) }),
    ),
    inputs: Object.fromEntries(
      Object.entries(input.inputs ?? {}).map(([key, values]) => [
        key,
        create(InstanceReferenceListSchema, {
          values: values.map(value =>
            create(InstanceReferenceSchema, {
              instanceId: value.instance_id,
              output: value.output,
              path: value.path,
            }),
          ),
        }),
      ]),
    ),
    hubInputs: Object.fromEntries(
      Object.entries(input.hub_inputs ?? {}).map(([key, values]) => [
        key,
        create(HubReferenceListSchema, {
          values: values.map(value => create(HubReferenceSchema, { hubId: value.hub_id })),
        }),
      ]),
    ),
    injectionInputs: (input.injection_inputs ?? []).map(value =>
      create(HubReferenceSchema, { hubId: value.hub_id }),
    ),
    position:
      input.position && input.position.x !== undefined && input.position.y !== undefined
        ? create(PositionSchema, { x: input.position.x, y: input.position.y })
        : undefined,
  })
}

export function toHub(input: z.infer<typeof hubInputSchema>): Hub {
  return create(HubSchema, {
    id: input.id,
    inputs: (input.inputs ?? []).map(value =>
      create(InstanceReferenceSchema, {
        instanceId: value.instance_id,
        output: value.output,
        path: value.path,
      }),
    ),
    injectionInputs: (input.injection_inputs ?? []).map(value =>
      create(HubReferenceSchema, { hubId: value.hub_id }),
    ),
    position: input.position ? create(PositionSchema, input.position) : undefined,
  })
}

export const operationTypeSchema = z.enum(["update", "preview", "destroy", "recreate", "refresh"])
export const operationOptionsInputSchema = z.object({
  force_update_dependencies: z.boolean().optional(),
  ignore_changed_dependencies: z.boolean().optional(),
  ignore_dependencies: z.boolean().optional(),
  force_update_children: z.boolean().optional(),
  only_destroy_ghosts: z.boolean().optional(),
  first_destroy_ghosts: z.boolean().optional(),
  ignore_ghosts: z.boolean().optional(),
  destroy_dependent_instances: z.boolean().optional(),
  invoke_destroy_triggers: z.boolean().optional(),
  delete_unreachable_resources: z.boolean().optional(),
  force_delete_state: z.boolean().optional(),
  allow_partial_composite_instance_update: z.boolean().optional(),
  allow_partial_composite_instance_destruction: z.boolean().optional(),
  refresh: z.boolean().optional(),
  debug: z.boolean().optional(),
})

export function operationType(value: z.infer<typeof operationTypeSchema>): OperationType {
  return {
    update: OperationType.UPDATE,
    preview: OperationType.PREVIEW,
    destroy: OperationType.DESTROY,
    recreate: OperationType.RECREATE,
    refresh: OperationType.REFRESH,
  }[value]
}

export function operationOptions(input: z.infer<typeof operationOptionsInputSchema>) {
  return create(OperationOptionsSchema, {
    forceUpdateDependencies: input.force_update_dependencies,
    ignoreChangedDependencies: input.ignore_changed_dependencies,
    ignoreDependencies: input.ignore_dependencies,
    forceUpdateChildren: input.force_update_children,
    onlyDestroyGhosts: input.only_destroy_ghosts,
    firstDestroyGhosts: input.first_destroy_ghosts,
    ignoreGhosts: input.ignore_ghosts,
    destroyDependentInstances: input.destroy_dependent_instances,
    invokeDestroyTriggers: input.invoke_destroy_triggers,
    deleteUnreachableResources: input.delete_unreachable_resources,
    forceDeleteState: input.force_delete_state,
    allowPartialCompositeInstanceUpdate: input.allow_partial_composite_instance_update,
    allowPartialCompositeInstanceDestruction: input.allow_partial_composite_instance_destruction,
    refresh: input.refresh,
    debug: input.debug,
  })
}

export type PlanDocument = {
  format_version: 1
  project_id: string
  type: z.infer<typeof operationTypeSchema>
  instance_ids: string[]
  options: z.infer<typeof operationOptionsInputSchema>
  phases: unknown[]
}

export const planDocumentSchema = z.object({
  format_version: z.literal(1),
  project_id: z.string().min(1),
  type: operationTypeSchema,
  instance_ids: z.array(z.string().min(1)).min(1),
  options: operationOptionsInputSchema.default({}),
  phases: z.array(z.json()),
})

export function phasesFromPlan(document: PlanDocument): OperationPhase[] {
  return document.phases.map(phase => fromJson(OperationPhaseSchema, phase as JsonValue))
}

export function phasesToJson(phases: OperationPhase[]): unknown[] {
  return phases.map(phase => toJson(OperationPhaseSchema, phase, { useProtoFieldName: true }))
}
