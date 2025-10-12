import type { boundaryInput, boundaryInputs } from "./evaluation"
import { z } from "zod"
import { componentKindSchema } from "./component"
import {
  type GenericName,
  genericNameSchema,
  objectMetaSchema,
  type VersionedName,
  versionedNameSchema,
} from "./meta"

declare const type: unique symbol

export type InstanceInput<TType extends string = string> = {
  [type]?: TType
  [boundaryInput]?: InstanceInput
  instanceId: InstanceId
  output: string
}

export type OptionalInstanceInput<TType extends string = string> =
  | ({ provided: true } & InstanceInput<TType>)
  | { provided: false; [boundaryInput]?: InstanceInput }

export type InstanceInputGroup<TType extends string = string> = InstanceInput<TType>[] & {
  [boundaryInputs]?: InstanceInputGroup<TType>
}

export function inputKey(input: InstanceInput): string {
  return `${input.instanceId}:${input.output}`
}

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type Position = z.infer<typeof positionSchema>

export const instanceIdSchema = z.templateLiteral([versionedNameSchema, ":", genericNameSchema])

export type InstanceId = z.infer<typeof instanceIdSchema>

export const instanceInputSchema = z.object({
  instanceId: instanceIdSchema,
  output: z.string(),
})

export const hubInputSchema = z.object({
  hubId: z.string(),
})

export type HubInput = z.infer<typeof hubInputSchema>

export const instanceModelPatchSchema = z.object({
  /**
   * The static arguments passed to the instance.
   */
  args: z.record(z.string(), z.unknown()).optional(),

  /**
   * The direct instances passed as inputs to the instance.
   */
  inputs: z.record(z.string(), z.array(instanceInputSchema)).optional(),

  /**
   * The resolved unit inputs for the instance.
   *
   * Only for computed composite instances.
   */
  hubInputs: z.record(z.string(), z.array(hubInputSchema)).optional(),

  /**
   * The inputs injected to the instance from the hubs.
   *
   * While `hubInputs` allows to pass hubs to distinct inputs,
   * `injectionInputs` allows to pass hubs to the instance as a whole filling all inputs with matching types.
   *
   * Only for designer-first instances.
   */
  injectionInputs: z.array(hubInputSchema).optional(),

  /**
   * The position of the instance on the canvas.
   *
   * Only for designer-first instances.
   */
  position: positionSchema.optional(),
})

export const instanceModelSchema = z.object({
  /**
   * The id of the instance unique within the project.
   *
   * The format is `${instanceType}:${instanceName}`.
   */
  id: instanceIdSchema,

  /**
   * The kind of the instance.
   *
   * Can be either "unit" or "composite".
   */
  kind: componentKindSchema,

  /**
   * The type of the instance.
   */
  type: versionedNameSchema,

  /**
   * The name of the instance.
   *
   * Must be unique within instances of the same type in the project.
   */
  name: genericNameSchema,

  ...instanceModelPatchSchema.shape,

  /**
   * The id of the top level parent instance.
   *
   * Only for child instances of the composite instances.
   */
  resolvedInputs: z.record(z.string(), z.array(instanceInputSchema)).optional(),

  /**
   * The ID of the parent instance.
   *
   * Only for child instances of the composite instances.
   */
  parentId: instanceIdSchema.optional(),

  /**
   * The direct instance outputs returned by the instance as outputs.
   *
   * Only for computed composite instances.
   */
  outputs: z.record(z.string(), z.array(instanceInputSchema)).optional(),

  /**
   * The resolved unit outputs for the instance.
   *
   * Only for computed composite instances.
   */
  resolvedOutputs: z.record(z.string(), z.array(instanceInputSchema)).optional(),
})

export type InstanceModel = z.infer<typeof instanceModelSchema>

export const hubModelPatchSchema = z.object({
  /**
   * The position of the hub on the canvas.
   */
  position: positionSchema.optional(),

  /**
   * The inputs of the hub.
   */
  inputs: z.array(instanceInputSchema).optional(),

  /**
   * The inputs injected to the hub from the hubs.
   *
   * While `inputs` allows to pass hubs to distinct inputs,
   * `injectionInputs` allows to pass hubs to the hub as a whole filling all inputs with matching types.
   */
  injectionInputs: z.array(hubInputSchema).optional(),
})

export const hubModelSchema = z.object({
  /**
   * The id of the hub unique within the project.
   */
  id: z.cuid2(),

  ...hubModelPatchSchema.shape,
})

export type InstanceModelPatch = z.infer<typeof instanceModelPatchSchema>
export type HubModel = z.infer<typeof hubModelSchema>
export type HubModelPatch = z.infer<typeof hubModelPatchSchema>

/**
 * Parses the instance id into the instance type and instance name.
 *
 * @param instanceId The instance id to parse.
 *
 * @returns The instance type and instance name.
 */
export function parseInstanceId(
  instanceId: string,
): [instanceType: VersionedName, instanceName: GenericName] {
  const parts = instanceId.split(":")

  if (parts.length !== 2) {
    throw new Error(`Invalid instance ID: ${instanceId}`)
  }

  return parts as [VersionedName, GenericName]
}

export function findInput<T extends string>(
  inputs: InstanceInput<T>[],
  name: string,
): InstanceInput<T> | null {
  const matchedInputs = inputs.filter(
    input => parseInstanceId(input.instanceId)[1] === name || input.instanceId === name,
  )

  if (matchedInputs.length === 0) {
    return null
  }

  if (matchedInputs.length > 1) {
    throw new Error(
      `Multiple inputs found for "${name}": ${matchedInputs.map(input => input.instanceId).join(", ")}. Specify the full instance id to disambiguate.`,
    )
  }

  return matchedInputs[0]
}

export function findRequiredInput<T extends string>(
  inputs: InstanceInput<T>[],
  name: string,
): InstanceInput<T> {
  const input = findInput(inputs, name)

  if (input === null) {
    throw new Error(`Required input "${name}" not found.`)
  }

  return input
}

export function findInputs<T extends string>(
  inputs: InstanceInput<T>[],
  names: string[],
): InstanceInput<T>[] {
  return names.map(name => findInput(inputs, name)).filter(Boolean) as InstanceInput<T>[]
}

export function findRequiredInputs<T extends string>(
  inputs: InstanceInput<T>[],
  names: string[],
): InstanceInput<T>[] {
  return names.map(name => findRequiredInput(inputs, name))
}

/**
 * The field names that indicate special objects which Highstate understands regardless of the context.
 *
 * UUIDs are used to prevent conflicts with user-defined fields.
 */
export enum HighstateSignature {
  Artifact = "d55c63ac-3174-4756-808f-f778e99af0d1",
  Yaml = "c857cac5-caa6-4421-b82c-e561fbce6367",
}

export const yamlValueSchema = z.object({
  [HighstateSignature.Yaml]: z.literal(true),
  value: z.string(),
})

export type YamlValue = z.infer<typeof yamlValueSchema>

export const fileMetaSchema = z.object({
  name: z.string(),
  contentType: z.string().optional(),
  size: z.number().optional(),
  mode: z.number().optional(),
})

export enum WellKnownInstanceCustomStatus {
  /**
   * The instance is in a healthy state.
   */
  Healthy = "healthy",

  /**
   * The instance is in a degraded state.
   */
  Degraded = "degraded",

  /**
   * The instance is in a down state/completely broken.
   */
  Down = "down",

  /**
   * The instance is in a warning state.
   */
  Warning = "warning",

  /**
   * The instance is progressing with some external sync operation,
   * such as a deployment or a data migration.
   */
  Progressing = "progressing",

  /**
   * The instance is in an error state.
   */
  Error = "error",
}

export const instanceStatusFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.string().array(),
])

export const instanceStatusFieldSchema = z.object({
  name: z.string(),

  meta: objectMetaSchema
    .pick({
      title: true,
      icon: true,
      iconColor: true,
    })
    .required({ title: true }),

  complementaryTo: z.string().optional(),
  value: instanceStatusFieldValueSchema.optional(),
})

export type InstanceStatusFieldValue = z.infer<typeof instanceStatusFieldValueSchema>
export type InstanceStatusField = z.infer<typeof instanceStatusFieldSchema>
