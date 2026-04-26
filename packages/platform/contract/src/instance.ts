/** biome-ignore-all lint/suspicious/noExplicitAny: for simplicity of the API, maybe fix later */

import type { Entity, EntityIncludeRef, EntityTypes } from "./entity"
import { z } from "zod"
import { createInput, createNonProvidedInput } from "./instance-input"
import {
  type GenericName,
  genericNameSchema,
  objectMetaSchema,
  type VersionedName,
  versionedNameSchema,
} from "./meta"
import { boundaryInput, componentKindSchema } from "./shared"

declare const type: unique symbol

export type InstanceInput = z.infer<typeof instanceInputSchema>

export type RuntimeInput<
  TTypes extends EntityTypes = EntityTypes,
  TPath extends string | undefined = string | undefined,
> = {
  [type]?: TTypes
  [boundaryInput]: InstanceInput
} & (
  | ({
      provided: true
      instanceId: InstanceId
      output: string
    } & (undefined extends TPath ? { path?: string } : { path: TPath }))
  | {
      provided: false
      path?: string
    }
)

export type MultipleInput<
  TInput extends RuntimeInput = RuntimeInput,
  TSelectors extends Record<string, unknown> = Record<never, never>,
> = TInput[] &
  TSelectors & {
    [boundaryInput]: InstanceInput
    path?: string
  }

type RequiredInputChildValue<TValue> = TValue extends RuntimeInput
  ? RequiredInput<TValue>
  : TValue extends MultipleInput<infer TItem, infer TSelectors>
    ? MultipleInput<RequiredInput<TItem>, RequiredInputChildSelectors<TSelectors>>
    : TValue extends Array<infer TItem>
      ? Array<RequiredInputChildValue<TItem>>
      : TValue

type RequiredInputChildSelectors<TSelectors extends Record<string, unknown>> = {
  [K in keyof TSelectors]: RequiredInputChildValue<TSelectors[K]>
}

type RequiredInputChildren<TInput extends RuntimeInput> = {
  [K in keyof TInput as K extends
    | "instanceId"
    | "output"
    | "path"
    | "provided"
    | typeof boundaryInput
    | typeof type
    ? never
    : K]: RequiredInputChildValue<TInput[K]>
}

type RequiredInputProvidedBranch<TInput extends RuntimeInput> = Extract<TInput, { provided: true }>

type StrictRequiredInput<TInput extends RuntimeInput> = RequiredInputProvidedBranch<TInput> &
  RequiredInputChildren<RequiredInputProvidedBranch<TInput>>

export type RequiredInput<TInput extends RuntimeInput = RuntimeInput> = StrictRequiredInput<TInput>

type RequiredMultipleInputSelectors<TInput extends RuntimeInput> = LiftMultipleSelectorFields<
  RequiredInputChildren<RequiredInputProvidedBranch<TInput>>
>

export type RequiredMultipleInput<TInput extends RuntimeInput = RuntimeInput> = MultipleInput<
  RequiredInput<TInput>,
  RequiredMultipleInputSelectors<TInput>
>

export type RequiredMultipleInputs<TInput extends RuntimeInput = RuntimeInput> =
  RequiredMultipleInput<TInput>

export type EntityInput<TEntity extends Entity> = TEntity extends Entity<
  VersionedName,
  infer TImplementedTypes,
  z.ZodTypeAny,
  unknown,
  unknown,
  infer TIncludes
>
  ? RuntimeInput<TImplementedTypes, undefined> &
      (TIncludes extends Record<string, EntityIncludeRef>
        ? EntityInputIncludes<TIncludes>
        : Record<never, never>)
  : never

export type RequiredEntityInput<TEntity extends Entity> = RequiredInput<EntityInput<TEntity>>

type EntityInputDepth = [1, 1, 1, 1]

type DecDepth<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest]
  ? Rest
  : readonly []

type ResolveIncludeEntity<TIncludeRef> = TIncludeRef extends { entity: infer E }
  ? E extends () => infer ER
    ? ER
    : E
  : TIncludeRef

type IncludeMultiple<TIncludeRef> = TIncludeRef extends { multiple?: infer M }
  ? M extends true
    ? true
    : false
  : false

type IncludeRequired<TIncludeRef> = TIncludeRef extends { required?: infer R }
  ? R extends false
    ? false
    : true
  : true

type IncludeRefValue<
  TIncludeRef,
  TDepth extends readonly unknown[],
> = ResolveIncludeEntity<TIncludeRef> extends infer TEntity
  ? TEntity extends Entity
    ? IncludeMultiple<TIncludeRef> extends true
      ? MultipleInput<
          EntityInputWithDepth<TEntity, TDepth>,
          TDepth extends readonly []
            ? Record<never, never>
            : TEntity extends Entity<
                  VersionedName,
                  EntityTypes,
                  z.ZodTypeAny,
                  unknown,
                  unknown,
                  infer TIncludes
                >
              ? TIncludes extends Record<string, EntityIncludeRef>
                ? LiftMultipleSelectorFields<EntityInputIncludes<TIncludes, DecDepth<TDepth>>>
                : Record<never, never>
              : Record<never, never>
        >
      : IncludeRequired<TIncludeRef> extends false
        ? OptionalEntityInput<TEntity, TDepth>
        : EntityInputWithDepth<TEntity, TDepth>
    : never
  : never

type OptionalEntityInput<TEntity extends Entity, TDepth extends readonly unknown[]> =
  | ({ provided: true } & EntityInputWithDepth<TEntity, TDepth>)
  | ({ provided: false; [boundaryInput]: InstanceInput } & OptionalizedInputFields<
      EntityInputWithDepth<TEntity, TDepth>
    >)

type OptionalizeInputValue<T> = [T] extends [InstanceInput]
  ? RuntimeInput
  : T extends MultipleInput<infer TItem, infer TSelectors>
    ? MultipleInput<OptionalizeInputValue<TItem>, OptionalizedSelectorFields<TSelectors>>
    : T extends Array<infer TItem>
      ? Array<OptionalizeInputValue<TItem>>
      : T

type OptionalizedSelectorFields<TSelectors extends Record<string, unknown>> = {
  [K in keyof TSelectors]: OptionalizeInputValue<TSelectors[K]>
}

type RuntimeInputSelectorFields<TInput extends RuntimeInput> = {
  [K in keyof TInput as K extends
    | "instanceId"
    | "output"
    | "path"
    | "provided"
    | typeof boundaryInput
    | typeof type
    ? never
    : K]: LiftMultipleSelectorValue<TInput[K]>
}

type LiftMultipleSelectorValue<T> = T extends MultipleInput<infer TItem, infer TSelectors>
  ? MultipleInput<TItem, LiftMultipleSelectorFields<TSelectors>>
  : T extends RuntimeInput
    ? MultipleInput<T, RuntimeInputSelectorFields<T>>
    : T

type LiftMultipleSelectorFields<TSelectors extends Record<string, unknown>> = {
  [K in keyof TSelectors]: LiftMultipleSelectorValue<TSelectors[K]>
}

type OptionalizedInputFields<TInput extends RuntimeInput> = {
  [K in keyof TInput as K extends "instanceId" | "output" | "provided" | typeof boundaryInput
    ? never
    : K]: OptionalizeInputValue<TInput[K]>
}

type EntityInputWithDepth<
  TEntity extends Entity,
  TDepth extends readonly unknown[],
> = TEntity extends Entity<
  VersionedName,
  infer TImplementedTypes,
  z.ZodTypeAny,
  unknown,
  unknown,
  infer TIncludes
>
  ? RuntimeInput<TImplementedTypes, undefined> &
      (TDepth extends readonly []
        ? Record<never, never>
        : TIncludes extends Record<string, EntityIncludeRef>
          ? EntityInputIncludes<TIncludes, DecDepth<TDepth>>
          : Record<never, never>)
  : never

type EntityInputIncludes<
  TIncludes extends Record<string, EntityIncludeRef>,
  TDepth extends readonly unknown[] = EntityInputDepth,
> = TIncludes extends Record<string, never>
  ? Record<never, never>
  : string extends keyof TIncludes
    ? Record<never, never>
    : {
        [K in keyof TIncludes]: IncludeRefValue<TIncludes[K], TDepth>
      }

export type InstanceInputGroup<TTypes extends EntityTypes = EntityTypes> = MultipleInput<
  RuntimeInput<TTypes>
>

type SelectInputResult<TInput extends RuntimeInput> = TInput extends RequiredInput<infer TRuntime>
  ? TRuntime
  : TInput

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
  path: z.string().optional(),
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

/**
 * Selects a single input from a group by instance id or instance name.
 *
 * The function accepts a plain array but still preserves Highstate boundary semantics.
 * It first tries to read boundary metadata from the array object itself and then falls back
 * to the first item boundary when needed.
 *
 * @param inputs The input group to search in.
 * @param name The instance id or instance name to select.
 * @returns The selected input with inherited group boundary, or a provided-false input when missing.
 */
export function selectInput<TInput extends RuntimeInput>(
  inputs: TInput[] & Partial<{ [boundaryInput]: InstanceInput }>,
  name: string,
): SelectInputResult<TInput> {
  const groupBoundary = inputs[boundaryInput] ?? inputs[0]?.[boundaryInput]

  if (inputs.length === 0 && !groupBoundary) {
    throw new Error(
      `Cannot select input "${name}": empty input group has no boundary metadata to build a missing input reference.`,
    )
  }

  const input = inputs.find(
    input =>
      input.provided &&
      (input.instanceId === name || parseInstanceId(input.instanceId)[1] === name),
  )

  if (!input || !input.provided) {
    const fallbackBoundary =
      groupBoundary ??
      inputs.find(input => Boolean(input[boundaryInput]))?.[boundaryInput] ??
      inputs[0]?.[boundaryInput]

    if (!fallbackBoundary) {
      throw new Error(
        `Cannot select input "${name}": input group has no boundary metadata to build a missing input reference.`,
      )
    }

    return createNonProvidedInput(fallbackBoundary) as SelectInputResult<TInput>
  }

  const boundary = groupBoundary ?? input[boundaryInput]
  return createInput(input, { boundary }) as SelectInputResult<TInput>
}

/**
 * The field names that indicate special objects which Highstate understands regardless of the context.
 *
 * UUIDs are used to prevent conflicts with user-defined fields.
 */
export enum HighstateSignature {
  Artifact = "d55c63ac-3174-4756-808f-f778e99af0d1",
  Yaml = "c857cac5-caa6-4421-b82c-e561fbce6367",
  Secret = "240e5789-6ae4-4b22-b9d8-87169e8b4bab",
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

export function secretSchema<TSchema extends z.ZodType>(
  schema: TSchema,
): z.ZodCodec<
  z.ZodUnion<
    [
      z.ZodObject<{
        [HighstateSignature.Secret]: z.ZodLiteral<true>
        value: TSchema
      }>,
      TSchema,
    ]
  >,
  z.ZodObject<{
    [HighstateSignature.Secret]: z.ZodLiteral<true>
    value: TSchema
  }>
> {
  const secretType = z.object({
    [HighstateSignature.Secret]: z.literal(true),
    value: schema,
  })

  return z.codec(z.union([secretType, schema]), secretType, {
    decode: value =>
      typeof value === "object" && value !== null && HighstateSignature.Secret in value
        ? (value as any)
        : { [HighstateSignature.Secret]: true, value },
    encode: value => value as any,
  })
}

export type Secret<T> = {
  [HighstateSignature.Secret]: true
  value: T
}

/**
 * Checks if the given value is a Secret.
 *
 * @param value The value to check.
 * @returns True if the value is a Secret, false otherwise.
 */
export function isSecret<T>(value: unknown): value is Secret<T> {
  return typeof value === "object" && value !== null && HighstateSignature.Secret in value
}
