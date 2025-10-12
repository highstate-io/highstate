/** biome-ignore-all lint/suspicious/noExplicitAny: maybe fix later */

import type { Simplify } from "type-fest"
import type { Entity } from "./entity"
import type { OptionalEmptyRecords, OptionalUndefinedFields, PartialKeys } from "./utils"
import { isNonNullish, mapValues, pickBy, uniqueBy } from "remeda"
import { z } from "zod"
import { boundaryInput, boundaryInputs, registerInstance } from "./evaluation"
import { camelCaseToHumanReadable } from "./i18n"
import { type InstanceId, type InstanceInput, type InstanceInputGroup, inputKey } from "./instance"
import {
  fieldNameSchema,
  genericNameSchema,
  objectMetaSchema,
  parseVersionedName,
  type VersionedName,
  versionedNameSchema,
} from "./meta"

export const runtimeSchema = Symbol("runtimeSchema")

let validationEnabled = true

export function setValidationEnabled(enabled: boolean): void {
  validationEnabled = enabled
}

export const componentKindSchema = z.enum(["composite", "unit"])
export type ComponentKind = z.infer<typeof componentKindSchema>

export const componentArgumentSchema = z.object({
  /**
   * The JSON schema of the argument value.
   */
  schema: z.custom<z.core.JSONSchema.BaseSchema>(),

  /**
   * The original Zod schema of the argument.
   *
   * Only available at runtime.
   */
  [runtimeSchema]: z.instanceof(z.ZodType).optional(),

  /**
   * Whether the argument is required.
   */
  required: z.boolean(),

  /**
   * The extra metadata of the argument.
   */
  meta: objectMetaSchema.required({ title: true }).pick({
    title: true,
    globalTitle: true,
    description: true,
    color: true,
    icon: true,
    iconColor: true,
  }),
})

export type ComponentArgument = z.infer<typeof componentArgumentSchema>

export type FullComponentArgumentOptions = {
  schema: z.ZodType
  meta?: PartialKeys<ComponentArgument["meta"], "title">
}

export type ComponentArgumentOptions = z.ZodType | FullComponentArgumentOptions

export type ComponentArgumentOptionsToSchema<T extends ComponentArgumentOptions> =
  T extends FullComponentArgumentOptions ? T["schema"] : T

export const componentInputSchema = z.object({
  /**
   * The type of the entity passed through the input.
   */
  type: versionedNameSchema,

  /**
   * Whether the input is required.
   */
  required: z.boolean(),

  /**
   * Whether the input can have multiple values.
   */
  multiple: z.boolean(),

  /**
   * The extra metadata of the input.
   */
  meta: objectMetaSchema.required({ title: true }).pick({
    title: true,
    description: true,
  }),
})

export type ComponentInput = z.infer<typeof componentInputSchema>

export type FullComponentInputOptions = {
  entity: Entity
  required?: boolean
  multiple?: boolean
  meta?: PartialKeys<ComponentInput["meta"], "title">
}

export type ComponentInputOptions = Entity | FullComponentInputOptions

type ComponentInputOptionsToOutputRef<T extends ComponentInputOptions> = T extends Entity
  ? InstanceInput<T["type"]>
  : T extends FullComponentInputOptions
    ? T["required"] extends false
      ? T["multiple"] extends true
        ? InstanceInput<T["entity"]["type"]>[] | undefined
        : InstanceInput<T["entity"]["type"]> | undefined
      : T["multiple"] extends true
        ? InstanceInput<T["entity"]["type"]>[]
        : InstanceInput<T["entity"]["type"]>
    : never

/**
 * The type-level specification of a component input hold by the component model.
 */
export type ComponentInputSpec = [entity: Entity, required: boolean, multiple: boolean]

export type ComponentInputOptionsToSpec<T extends ComponentInputOptions> = T extends Entity
  ? [T, true, false] // [Entity, required, multiple]
  : T extends FullComponentInputOptions
    ? T["required"] extends false
      ? T["multiple"] extends true
        ? [T["entity"], false, true]
        : [T["entity"], false, false]
      : T["multiple"] extends true
        ? [T["entity"], true, true]
        : [T["entity"], true, false]
    : never

export type ComponentInputOptionsMapToSpecMap<T extends Record<string, ComponentInputOptions>> =
  T extends Record<string, never>
    ? Record<string, never>
    : { [K in keyof T]: ComponentInputOptionsToSpec<T[K]> }

type ComponentInputMapToValue<T extends Record<string, ComponentInputOptions>> =
  OptionalUndefinedFields<{
    [K in keyof T]: ComponentInputOptionsToOutputRef<T[K]>
  }>

type ComponentInputMapToReturnType<T extends Record<string, ComponentInputOptions>> =
  // biome-ignore lint/suspicious/noConfusingVoidType: this is return type
  T extends Record<string, never> ? void : ComponentInputMapToValue<T>

export type ComponentParams<
  TArgs extends Record<string, ComponentArgumentOptions>,
  TInputs extends Record<string, ComponentInputOptions>,
> = {
  id: InstanceId
  name: string
  args: { [K in keyof TArgs]: z.infer<ComponentArgumentOptionsToSchema<TArgs[K]>> }
  inputs: ComponentInputMapToValue<TInputs>
}

export type InputComponentParams<
  TArgs extends Record<string, unknown>,
  TInputs extends Record<string, unknown>,
> = {
  name: string
} & OptionalEmptyRecords<{
  args: TArgs
  inputs: TInputs
}>

export type ComponentOptions<
  TArgs extends Record<string, ComponentArgumentOptions>,
  TInputs extends Record<string, ComponentInputOptions>,
  TOutputs extends Record<string, ComponentInputOptions>,
> = {
  /**
   * The type of the component.
   * Must be a valid versioned name.
   *
   * Examples: `proxmox.virtual-machine.v1`, `common.server.v1`.
   */
  type: VersionedName

  /**
   * The extra metadata of the component.
   *
   * If title or defaultNamePrefix is not provided, they will be generated from the type.
   */
  meta?: PartialKeys<ComponentModel["meta"], "title" | "defaultNamePrefix">

  /**
   * The specification of the component arguments.
   */
  args?: TArgs

  /**
   * The specification of the component inputs.
   */
  inputs?: TInputs

  /**
   * The specification of the component outputs.
   */
  outputs?: TOutputs

  /**
   * The create function of the component.
   *
   * It can create instances of other components and return their outputs.
   *
   * Note: All created instances must guarantee unique ids within the project.
   * Their names are not automatically prefixed with the component name,
   * so you must prefix them manually if needed or guarantee uniqueness in another way.
   */
  create: (params: ComponentParams<TArgs, TInputs>) => ComponentInputMapToReturnType<TOutputs>

  /**
   * For internal use only.
   */
  [kind]?: ComponentKind
}

// Models
export const componentModelSchema = z.object({
  /**
   * The type of the component.
   */
  type: genericNameSchema,

  /**
   * The kind of the component.
   */
  kind: componentKindSchema,

  /**
   * The record of the argument schemas.
   */
  args: z.record(fieldNameSchema, componentArgumentSchema),

  /**
   * The record of the input schemas.
   */
  inputs: z.record(fieldNameSchema, componentInputSchema),

  /**
   * The record of the output schemas.
   */
  outputs: z.record(fieldNameSchema, componentInputSchema),

  /**
   * The extra metadata of the component.
   */
  meta: objectMetaSchema
    .required({ title: true })
    .pick({
      title: true,
      description: true,
      color: true,
      icon: true,
      iconColor: true,
      secondaryIcon: true,
      secondaryIconColor: true,
    })
    .extend({
      /**
       * The category of the component.
       *
       * Used to group components in the UI.
       */
      category: z.string().optional(),

      /**
       * The default name prefix for the component instances.
       *
       * Used to generate default names for the instances.
       */
      defaultNamePrefix: z.string(),
    }),

  /**
   * The CRC32 of the component definition.
   */
  definitionHash: z.number(),
})

export type ComponentModel = z.infer<typeof componentModelSchema>

type InputSpecToInputRef<T extends ComponentInputSpec> = T[1] extends true
  ? T[2] extends true
    ? InstanceInput<T[0]["type"]>[]
    : InstanceInput<T[0]["type"]>
  : T[2] extends true
    ? InstanceInput<T[0]["type"]>[] | undefined
    : InstanceInput<T[0]["type"]> | undefined

type InputSpecToOutputRef<T extends ComponentInputSpec> = T[2] extends true
  ? InstanceInput<T[0]["type"]>[]
  : InstanceInput<T[0]["type"]>

export type InputSpecMapToInputRefMap<TInputs extends Record<string, ComponentInputSpec>> =
  TInputs extends Record<string, [string, never, never]>
    ? Record<string, never>
    : { [K in keyof TInputs]: InputSpecToInputRef<TInputs[K]> }

export type OutputRefMap<TInputs extends Record<string, ComponentInputSpec>> =
  TInputs extends Record<string, [string, never, never]>
    ? Record<string, never>
    : { [K in keyof TInputs]: InputSpecToOutputRef<TInputs[K]> }

export const originalCreate = Symbol("originalCreate")
export const kind = Symbol("kind")

export type Component<
  TArgs extends Record<string, z.ZodType> = Record<string, never>,
  TInputs extends Record<string, ComponentInputSpec> = Record<string, never>,
  TOutputs extends Record<string, ComponentInputSpec> = Record<string, never>,
> = {
  /**
   * The non-generic model of the component.
   */
  model: ComponentModel

  /**
   * The entities used in the inputs or outputs of the component.
   */
  entities: Map<string, Entity>

  /**
   * The create function of the component.
   *
   * Used to create instances of the component.
   */
  (
    context: InputComponentParams<
      { [K in keyof TArgs]: z.input<TArgs[K]> },
      InputSpecMapToInputRefMap<TInputs>
    >,
  ): OutputRefMap<TOutputs>

  /**
   * The original create function.
   *
   * Used to calculate the definition hash.
   */
  [originalCreate]: (params: InputComponentParams<any, any>) => any
}

export function defineComponent<
  TArgs extends Record<string, ComponentArgumentOptions> = Record<string, never>,
  TInputs extends Record<string, ComponentInputOptions> = Record<string, never>,
  TOutputs extends Record<string, ComponentInputOptions> = Record<string, never>,
>(
  options: ComponentOptions<TArgs, TInputs, TOutputs>,
): Component<
  { [K in keyof TArgs]: ComponentArgumentOptionsToSchema<TArgs[K]> },
  { [K in keyof TInputs]: ComponentInputOptionsToSpec<TInputs[K]> },
  { [K in keyof TOutputs]: ComponentInputOptionsToSpec<TOutputs[K]> }
> {
  try {
    componentModelSchema.shape.type.parse(options.type)
  } catch (error) {
    throw new Error(`Invalid component type "${options.type}"`, { cause: error })
  }

  if (!options.create) {
    throw new Error("Component create function is required")
  }

  const entities = new Map<string, Entity>()
  const mapInput = createInputMapper(entities)

  const model: ComponentModel = {
    type: options.type,
    kind: options[kind] ?? "composite",
    args: mapValues(options.args ?? {}, mapArgument),
    inputs: mapValues(options.inputs ?? {}, mapInput),
    outputs: mapValues(options.outputs ?? {}, mapInput),
    meta: {
      ...options.meta,
      title: options.meta?.title || camelCaseToHumanReadable(parseVersionedName(options.type)[0]),
      defaultNamePrefix:
        options.meta?.defaultNamePrefix ||
        parseVersionedName(options.type)[0].split(".").slice(-1)[0],
    },
    // will be calculated by library loader
    definitionHash: null!,
  }

  function create(
    params: InputComponentParams<any, Record<string, InstanceInput | InstanceInputGroup>>,
  ): any {
    const { name, args = {}, inputs } = params
    const instanceId = getInstanceId(options.type, name)

    const flatInputs: Record<string, InstanceInputGroup> = {}
    const tracedInputs: Record<string, InstanceInput[]> = {}

    for (const [key, inputGroup] of Object.entries(inputs ?? {})) {
      if (!inputGroup) {
        continue
      }

      if (!Array.isArray(inputGroup)) {
        if (inputGroup[boundaryInput]) {
          tracedInputs[key] = [inputGroup[boundaryInput]]
        }

        flatInputs[key] = [inputGroup]
        continue
      }

      // merge "boundaryInputs" attached to array with "boundaryInput"s attached to individual items
      const group: InstanceInput[] = [...(inputGroup[boundaryInputs] ?? [])]
      const inputs: InstanceInput[] = []

      for (const item of inputGroup.flat(1)) {
        if (item[boundaryInput]) {
          group.push(item[boundaryInput])
        }

        inputs.push(item)
      }

      tracedInputs[key] = uniqueBy(group, inputKey)
      flatInputs[key] = uniqueBy(inputs, inputKey)
    }

    return registerInstance(
      create as unknown as Component,
      {
        id: instanceId,
        type: options.type,
        kind: options[kind] ?? "composite",
        name,
        args,
        inputs: tracedInputs,
        resolvedInputs: mapValues(flatInputs, inputs =>
          inputs.filter(input => !("provided" in input && input.provided === false)),
        ),
      },
      () => {
        const markedInputs = mapValues(model.inputs, (componentInput, key) => {
          if (!componentInput.multiple) {
            // for single component use first available input and attach boundaryInput
            // technically, caller can pass multiple inputs or array of inputs ignoring the TypeScript restriction,
            // but we don't care about that
            const input = flatInputs[key]?.[0]

            if (input) {
              // return the input with boundaryInput attached
              // the input can also be "OptionalInstanceInput" with "provided: false", but this is still correct
              return { ...input, [boundaryInput]: { instanceId: instanceId, output: key } }
            }

            // create a new "not provided" input with boundaryInput attached
            return { provided: false, [boundaryInput]: { instanceId: instanceId, output: key } }
          }

          // then handle array of inputs
          // caller can provide array of array which will be flattened with boundaryInputs preserved
          // regardless of the number of inputs, we always attach boundaryInputs to the whole array
          const inputs = flatInputs[key] ?? []
          inputs[boundaryInputs] = [{ instanceId, output: key }]

          return inputs
        })

        const outputs: Record<string, InstanceInput[]> =
          options.create({
            id: instanceId,
            name,
            args: processArgs(instanceId, create.model, args) as any,
            inputs: markedInputs as any,
          }) ?? {}

        return mapValues(pickBy(outputs, isNonNullish), outputs => [outputs].flat(2))
      },
    )
  }

  try {
    create.entities = entities
    create.model = model

    create[originalCreate] = options.create

    return create as any
  } catch (error) {
    throw new Error(`Failed to define component "${options.type}"`, { cause: error })
  }
}

function processArgs(
  instanceId: InstanceId,
  model: ComponentModel,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!validationEnabled) {
    return args
  }

  const validatedArgs: Record<string, unknown> = {}

  for (const [key, arg] of Object.entries(model.args)) {
    if (arg.schema) {
      const result = arg[runtimeSchema]!.safeParse(args[key])

      if (!result.success) {
        throw new Error(
          `Invalid argument "${key}" in instance "${instanceId}": ${result.error.message}`,
        )
      }

      validatedArgs[key] = result.data
    } else {
      validatedArgs[key] = args[key]
    }
  }

  return validatedArgs
}

/**
 * Checks if the value is a Highstate component.
 *
 * Does not guarantee that the value is a valid component, only that it has the expected structure.
 *
 * @param value The value to check.
 * @returns True if the value is a component, false otherwise.
 */
export function isComponent(value: unknown): value is Component {
  return typeof value === "function" && "model" in value
}

function isSchemaOptional(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success
}

export function mapArgument(value: ComponentArgumentOptions, key: string): ComponentArgument {
  if ("schema" in value) {
    return {
      schema: z.toJSONSchema(value.schema, { target: "draft-7", io: "input" }),
      [runtimeSchema]: value.schema,
      required: !isSchemaOptional(value.schema),
      meta: {
        ...value.meta,
        title: value.meta?.title || camelCaseToHumanReadable(key),
      },
    }
  }

  return {
    schema: z.toJSONSchema(value, { target: "draft-7", io: "input" }),
    [runtimeSchema]: value,
    required: !isSchemaOptional(value),
    meta: {
      title: camelCaseToHumanReadable(key),
    },
  }
}

export function createInputMapper(entities: Map<string, Entity>) {
  return (value: ComponentInputOptions, key: string): ComponentInput => {
    if (!value) {
      throw new Error(`Input/output "${key}" is undefined in the component model.`)
    }

    if ("entity" in value) {
      entities.set(value.entity.type, value.entity)

      return {
        type: value.entity.type,
        required: value.required ?? true,
        multiple: value.multiple ?? false,
        meta: {
          ...value.meta,
          title: value.meta?.title || camelCaseToHumanReadable(key),
        },
      }
    }

    entities.set(value.type, value)

    return {
      type: value.type,
      required: true,
      multiple: false,
      meta: {
        title: camelCaseToHumanReadable(key),
      },
    }
  }
}

/**
 * Formats the instance id from the instance type and instance name.
 *
 * @param instanceType The type of the instance.
 * @param instanceName The name of the instance.
 *
 * @returns The formatted instance id.
 */
export function getInstanceId(instanceType: VersionedName, instanceName: string): InstanceId {
  return `${instanceType}:${instanceName}`
}

export type ToFullComponentArgumentOptions<T extends Record<string, ComponentArgumentOptions>> =
  Simplify<{
    [K in keyof T]: T[K] extends z.ZodType ? { schema: T[K] } : T[K]
  }>

export function toFullComponentArgumentOptions<T extends Record<string, ComponentArgumentOptions>>(
  args: T,
): ToFullComponentArgumentOptions<T> {
  return mapValues(args, arg => ("schema" in arg ? arg : { schema: arg })) as any
}

type ToFullComponentInputOptions<T extends Record<string, ComponentInputOptions>> = Simplify<{
  [K in keyof T]: T[K] extends Entity ? { entity: T[K] } : T[K]
}>

function toFullComponentInputOptions<T extends Record<string, ComponentInputOptions>>(
  inputs: T,
): ToFullComponentInputOptions<T> {
  return mapValues(inputs, input => ("entity" in input ? input : { entity: input })) as any
}

/**
 * The helper marker for component arguments.
 *
 * Helps validating arguments types and gives the compiler a hint for generating `meta` fields.
 */
export function $args<T extends Record<string, ComponentArgumentOptions>>(
  args: T,
): ToFullComponentArgumentOptions<T> {
  return toFullComponentArgumentOptions(args)
}

/**
 * The helper marker for component inputs.
 *
 * Helps validating inputs types and gives the compiler a hint for generating `meta` fields.
 */
export function $inputs<T extends Record<string, ComponentInputOptions>>(
  inputs: T,
): ToFullComponentInputOptions<T> {
  return toFullComponentInputOptions(inputs)
}

/**
 * The helper marker for component outputs.
 *
 * Helps validating outputs types and gives the compiler a hint for generating `meta` fields.
 */
export function $outputs<T extends Record<string, ComponentInputOptions>>(
  outputs: T,
): ToFullComponentInputOptions<T> {
  return toFullComponentInputOptions(outputs)
}

/**
 * Adds a description to the argument which can be both a schema or full argument options.
 *
 * Used by the compiler to inject descriptions into the argument schema.
 * You probably won't need to use it directly.
 */
export function $addArgumentDescription(
  argument: ComponentArgumentOptions,
  description: string,
): FullComponentArgumentOptions {
  if ("schema" in argument) {
    return {
      ...argument,
      meta: {
        ...argument.meta,
        description: argument.meta?.description ?? description,
      },
    }
  }

  return {
    schema: argument,
    meta: {
      description: description,
    },
  }
}

/**
 * Adds a description to the input which can be both an entity or full input options.
 *
 * Used by the compiler to inject descriptions into the input schema.
 * You probably won't need to use it directly.
 */
export function $addInputDescription(
  input: ComponentInputOptions,
  description: string,
): ComponentInputOptions {
  if ("entity" in input) {
    return {
      ...input,
      meta: {
        ...input.meta,
        description: input.meta?.description ?? description,
      },
    }
  }

  return {
    entity: input,
    meta: {
      description: description,
    },
  }
}
