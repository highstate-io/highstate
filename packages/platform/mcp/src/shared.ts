import type {
  InstanceState,
  OperationOptions,
  OperationPhase,
  OperationType,
} from "@highstate/api/v1"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { HighstateClients } from "./client"
import { create, type DescMessage, fromJson, type MessageShape, toJson } from "@bufbuild/protobuf"
import { ValueSchema } from "@bufbuild/protobuf/wkt"
import {
  ComponentArgumentMapEntrySchema,
  ComponentKind,
  type Hub,
  HubReferenceListSchema,
  HubReferenceSchema,
  HubSchema,
  type Instance,
  InstanceReferenceListSchema,
  InstanceReferenceSchema,
  InstanceSchema,
  OperationOptionsSchema,
  PositionSchema,
  type OperationOptions as ProtoOperationOptions,
} from "@highstate/api/v1"
import { stringify } from "yaml"
import { z } from "zod"

export const operationTypeSchema = z.enum(["update", "preview", "destroy", "recreate", "refresh"])
export const projectIdSchema = z.string().min(1).describe("Project ID")
export const hubIdSchema = z.cuid2().describe("Hub ID")

const jsonValueSchema = z.json()

const instanceReferenceSchema = z.object({
  instanceId: z.string().min(1).describe("Referenced instance ID"),
  output: z.string().min(1).describe("Referenced output name"),
  path: z.string().min(1).optional().describe("Optional path within the output value"),
})

const hubReferenceSchema = z.object({
  hubId: hubIdSchema.describe("Referenced hub ID"),
})

const positionSchema = z.object({
  x: z.number().describe("Horizontal canvas position"),
  y: z.number().describe("Vertical canvas position"),
})

const instancePatchFields = {
  args: z
    .record(z.string(), jsonValueSchema)
    .optional()
    .describe("Static component arguments keyed by argument name"),
  inputs: z
    .record(z.string(), z.array(instanceReferenceSchema))
    .optional()
    .describe("Direct instance inputs keyed by component input name"),
  hub_inputs: z
    .record(z.string(), z.array(hubReferenceSchema))
    .optional()
    .describe("Hub inputs keyed by component input name"),
  injection_inputs: z
    .array(hubReferenceSchema)
    .optional()
    .describe("Hubs injected into compatible component inputs"),
  position: positionSchema
    .partial()
    .nullable()
    .optional()
    .describe("Optional canvas position; null clears the position"),
}

export const instanceInputSchema = z
  .object({
    id: z.string().min(1).describe("Instance ID in type:name format"),
    kind: z.enum(["unit", "composite"]).describe("Instance kind"),
    type: z.string().min(1).describe("Versioned component type"),
    name: z.string().min(1).describe("Instance name"),
    ...instancePatchFields,
  })
  .describe("Complete resident instance model")

export const hubInputSchema = z
  .object({
    id: hubIdSchema,
    inputs: z
      .array(instanceReferenceSchema)
      .optional()
      .describe("Instance outputs provided by the hub"),
    injection_inputs: z
      .array(hubReferenceSchema)
      .optional()
      .describe("Hubs injected into this hub"),
    position: positionSchema.optional().describe("Optional canvas position"),
  })
  .describe("Complete resident hub model")

export const instancePatchSchema = z
  .object(instancePatchFields)
  .describe("Fields to replace on an existing instance")

export const hubPatchSchema = z
  .object({
    inputs: z
      .array(instanceReferenceSchema)
      .optional()
      .describe("Instance outputs provided by the hub"),
    injection_inputs: z
      .array(hubReferenceSchema)
      .optional()
      .describe("Hubs injected into this hub"),
    position: positionSchema
      .partial()
      .nullable()
      .optional()
      .describe("Optional canvas position; null clears the position"),
  })
  .describe("Fields to replace on an existing hub")

export const operationOptionsSchema = z
  .object({
    force_update_dependencies: z
      .boolean()
      .optional()
      .describe("Update every dependency regardless of state"),
    ignore_changed_dependencies: z.boolean().optional().describe("Skip only changed dependencies"),
    ignore_dependencies: z
      .boolean()
      .optional()
      .describe("Operate only on explicitly requested instances"),
    force_update_children: z
      .boolean()
      .optional()
      .describe("Update every child of affected composites"),
    only_destroy_ghosts: z.boolean().optional().describe("Run only ghost cleanup for an update"),
    first_destroy_ghosts: z
      .boolean()
      .optional()
      .describe("Run ghost cleanup before the update phase"),
    ignore_ghosts: z.boolean().optional().describe("Skip ghost cleanup during an update"),
    destroy_dependent_instances: z
      .boolean()
      .optional()
      .describe("Include dependents during destroy"),
    invoke_destroy_triggers: z
      .boolean()
      .optional()
      .describe("Run destroy triggers instead of direct deletion"),
    delete_unreachable_resources: z
      .boolean()
      .optional()
      .describe("Delete unreachable provider resources"),
    force_delete_state: z.boolean().optional().describe("Delete state even when destruction fails"),
    allow_partial_composite_instance_update: z
      .boolean()
      .optional()
      .describe("Update only necessary composite children"),
    allow_partial_composite_instance_destruction: z
      .boolean()
      .optional()
      .describe("Destroy only necessary composite children"),
    refresh: z.boolean().optional().describe("Refresh provider state for selected instances"),
    debug: z.boolean().optional().describe("Enable Pulumi and provider debug logging"),
  })
  .describe("Options controlling dependency traversal, execution, and cleanup")

export const operationMetaSchema = z
  .object({
    title: z.string().min(1).describe("Operation display title"),
    description: z.string().optional().describe("Optional operation description"),
  })
  .describe("Operation display metadata")

export function toInstanceMessage(input: z.infer<typeof instanceInputSchema>): Instance {
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
          values: values.map(value => create(InstanceReferenceSchema, value)),
        }),
      ]),
    ),
    hubInputs: Object.fromEntries(
      Object.entries(input.hub_inputs ?? {}).map(([key, values]) => [
        key,
        create(HubReferenceListSchema, {
          values: values.map(value => create(HubReferenceSchema, value)),
        }),
      ]),
    ),
    injectionInputs: (input.injection_inputs ?? []).map(value => create(HubReferenceSchema, value)),
    position: input.position ? create(PositionSchema, input.position) : undefined,
  })
}

export function toHubMessage(
  input: z.infer<typeof hubInputSchema> | ({ id: string } & z.infer<typeof hubPatchSchema>),
): Hub {
  return create(HubSchema, {
    id: input.id,
    inputs: (input.inputs ?? []).map(value => create(InstanceReferenceSchema, value)),
    injectionInputs: (input.injection_inputs ?? []).map(value => create(HubReferenceSchema, value)),
    position:
      input.position && "x" in input.position && "y" in input.position
        ? create(PositionSchema, input.position)
        : undefined,
  })
}

export type PartialPosition = Partial<z.infer<typeof positionSchema>> | null | undefined

export function mergePosition(
  position: PartialPosition,
  currentPosition: { x: number; y: number } | undefined,
): PartialPosition {
  if (position === null || position === undefined) {
    return position
  }

  return {
    x: position.x ?? currentPosition?.x ?? 0,
    y: position.y ?? currentPosition?.y ?? 0,
  }
}

export function toInstanceUpdateMaskPaths(patch: z.infer<typeof instancePatchSchema>): string[] {
  return Object.keys(patch).map(path => (path === "args" ? "arguments" : path))
}

export function toOperationOptionsMessage(
  input: z.infer<typeof operationOptionsSchema>,
): ProtoOperationOptions {
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

export type StoredPlan = {
  projectId: string
  type: OperationType
  instanceIds: string[]
  options?: OperationOptions
  phases: OperationPhase[]
}

export type ToolServer = {
  mcp: McpServer
  clients: HighstateClients
  plans: Map<string, StoredPlan>
}

export function messageToolResult<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): CallToolResult {
  return toolResult(toJson(schema, message, { useProtoFieldName: true }))
}

export function textToolResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] }
}

export function toolResult(value: unknown): CallToolResult {
  return textToolResult(stringify(value, { blockQuote: "literal", lineWidth: 0 }).trimEnd())
}

export function successResult(): CallToolResult {
  return textToolResult("Success")
}

export function timestampFromUlid(id: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let timestamp = 0

  for (const character of id.slice(0, 10).toUpperCase()) {
    const value = alphabet.indexOf(character)
    if (value === -1) {
      return id
    }

    timestamp = timestamp * 32 + value
  }

  return new Date(timestamp).toISOString()
}

export async function getInstanceStates(
  clients: HighstateClients,
  projectId: string,
): Promise<InstanceState[]> {
  const states: InstanceState[] = []
  let pageToken = ""

  do {
    const response = await clients.instanceState.listInstanceStates({
      projectId,
      includeEvaluationState: true,
      includeLastOperationState: true,
      includeParentInstanceId: true,
      includeExtra: true,
      includeCustomStatuses: true,
      pageSize: 100,
      pageToken,
    })
    states.push(...response.states)
    pageToken = response.nextPageToken
  } while (pageToken)

  return states
}
