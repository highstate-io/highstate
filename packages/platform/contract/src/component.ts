/** biome-ignore-all lint/suspicious/noExplicitAny: maybe fix later */

import type { Simplify } from "type-fest"
import type { Entity, implementedTypes } from "./entity"
import type { OptionalEmptyRecords, PartialKeys } from "./utils"
import { isNonNullish, mapValues, pickBy, uniqueBy } from "remeda"
import { z } from "zod"
import { boundaryInput, registerInstance } from "./evaluation"
import { camelCaseToHumanReadable } from "./i18n"
import {
  type EntityInput,
  type InstanceId,
  type InstanceInput,
  inputKey,
  type MultipleInput,
  type RequiredInput,
  type RequiredMultipleInput,
  type RuntimeInput,
} from "./instance"
import {
  createDeepOutputAccessor,
  createInput,
  createMultipleInputAccessor,
  createNonProvidedInput,
} from "./instance-input"
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
   * The input name this output type is derived from.
   *
   * If set, the output uses the referenced input as its fallback type source.
   */
  fromInput: fieldNameSchema.optional(),

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

export type FromInputComponentOutputOptions<TInputName extends string = string> = {
  fromInput: TInputName
  meta?: PartialKeys<ComponentInput["meta"], "title">
}

export type ComponentOutputOptions<
  TInputs extends Record<string, ComponentInputOptions> = Record<string, ComponentInputOptions>,
> = ComponentInputOptions | FromInputComponentOutputOptions<Extract<keyof TInputs, string>>

type ComponentInputOptionsToOutputRef<T extends ComponentInputOptions> = T extends Entity
  ? EntityInput<T>
  : T extends FullComponentInputOptions
    ? T["multiple"] extends true
      ? RequiredMultipleInput<EntityInput<T["entity"]>>
      : EntityInput<T["entity"]>
    : never

type MultipleInputConstructorValue<TEntity extends Entity> =
  | MultipleInput<EntityInput<TEntity>>
  | EntityInput<TEntity>[]
  | InstanceInput[]
  | Array<MultipleInput<EntityInput<TEntity>> | EntityInput<TEntity>[] | InstanceInput[]>

/**
 * The type-level specification of a component input hold by the component model.
 */
export type ComponentInputSpec<TEntity extends Entity = Entity> = [
  entity: TEntity,
  required: boolean,
  multiple: boolean,
]

export type ComponentInputOptionsToSpec<T extends ComponentInputOptions> = T extends Entity
  ? [T, true, false]
  : T extends FullComponentInputOptions
    ? T["required"] extends false
      ? T["multiple"] extends true
        ? ComponentInputSpec<T["entity"]> extends infer Spec
          ? Spec extends ComponentInputSpec
            ? [Spec[0], false, true]
            : never
          : never
        : ComponentInputSpec<T["entity"]> extends infer Spec
          ? Spec extends ComponentInputSpec
            ? [Spec[0], false, false]
            : never
          : never
      : T["multiple"] extends true
        ? ComponentInputSpec<T["entity"]> extends infer Spec
          ? Spec extends ComponentInputSpec
            ? [Spec[0], true, true]
            : never
          : never
        : ComponentInputSpec<T["entity"]> extends infer Spec
          ? Spec extends ComponentInputSpec
            ? [Spec[0], true, false]
            : never
          : never
    : never

export type ComponentOutputOptionsToSpec<
  TOutput extends ComponentOutputOptions<TInputs>,
  TInputs extends Record<string, ComponentInputOptions>,
> = TOutput extends FromInputComponentOutputOptions<infer TInputName>
  ? TInputName extends keyof TInputs
    ? ComponentInputOptionsToSpec<TInputs[TInputName]>
    : never
  : TOutput extends ComponentInputOptions
    ? ComponentInputOptionsToSpec<TOutput>
    : never

export type ComponentInputOptionsMapToSpecMap<T extends Record<string, ComponentInputOptions>> =
  T extends Record<string, never>
    ? Record<string, never>
    : { [K in keyof T]: ComponentInputOptionsToSpec<T[K]> }

type ComponentInputMapToValue<T extends Record<string, ComponentInputOptions>> = {
  [K in keyof T]: ComponentInputOptionsToOutputRef<T[K]>
}

type ComponentOutputMapToCreateOutputValue<
  TOutputs extends Record<string, ComponentOutputOptions<TInputs>>,
  TInputs extends Record<string, ComponentInputOptions>,
> = {
  [K in keyof TOutputs]: InputSpecToInputRef<ComponentOutputOptionsToSpec<TOutputs[K], TInputs>>
}

type ComponentOutputMapToReturnType<
  TOutputs extends Record<string, ComponentOutputOptions<TInputs>>,
  TInputs extends Record<string, ComponentInputOptions>,
> = TOutputs extends Record<string, never> // biome-ignore lint/suspicious/noConfusingVoidType: this is return type
  ? void
  : Partial<ComponentOutputMapToCreateOutputValue<TOutputs, TInputs>>

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
  TType extends VersionedName,
  TArgs extends Record<string, ComponentArgumentOptions>,
  TInputs extends Record<string, ComponentInputOptions>,
  TOutputs extends Record<string, ComponentOutputOptions<TInputs>>,
> = {
  /**
   * The type of the component.
   * Must be a valid versioned name.
   *
   * Examples: `proxmox.virtual-machine.v1`, `common.server.v1`.
   */
  type: TType

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
  create: (
    params: ComponentParams<TArgs, TInputs>,
  ) => ComponentOutputMapToReturnType<TOutputs, TInputs>

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
    ? MultipleInputConstructorValue<T[0]>
    : EntityInput<T[0]> | InstanceInput
  : T[2] extends true
    ? MultipleInputConstructorValue<T[0]>
    : EntityInput<T[0]> | InstanceInput

type InputSpecToUnitOutputRef<T extends ComponentInputSpec> = T[2] extends true
  ? RequiredMultipleInput<EntityInput<T[0]>>
  : RequiredInput<EntityInput<T[0]>>

type InputSpecToCompositeOutputRef<T extends ComponentInputSpec> = T[2] extends true
  ? RequiredMultipleInput<EntityInput<T[0]>>
  : EntityInput<T[0]>

export type InputSpecMapToInputRefMap<TInputs extends Record<string, ComponentInputSpec>> =
  TInputs extends Record<string, [string, never, never]>
    ? Record<string, never>
    : {
        [K in keyof TInputs as TInputs[K][1] extends true ? K : never]-?: InputSpecToInputRef<
          TInputs[K]
        >
      } & {
        [K in keyof TInputs as TInputs[K][1] extends true ? never : K]?: InputSpecToInputRef<
          TInputs[K]
        >
      }

export type OutputRefMap<
  TInputs extends Record<string, ComponentInputSpec>,
  TKind extends ComponentKind = "composite",
> = TInputs extends Record<string, [string, never, never]>
  ? Record<string, never>
  : {
      [K in keyof TInputs]: TKind extends "unit"
        ? InputSpecToUnitOutputRef<TInputs[K]>
        : InputSpecToCompositeOutputRef<TInputs[K]>
    }

type StaticOutputRefByKind<
  TOutputSpec extends ComponentInputSpec,
  TKind extends ComponentKind,
> = TKind extends "unit"
  ? InputSpecToUnitOutputRef<TOutputSpec>
  : InputSpecToCompositeOutputRef<TOutputSpec>

type ResolveForwardedOutputRef<
  TForwardedInputName extends string,
  TCallInputs extends Record<string, unknown>,
  TFallbackSpec extends ComponentInputSpec,
  TKind extends ComponentKind,
> = TForwardedInputName extends keyof TCallInputs
  ? NonNullable<TCallInputs[TForwardedInputName]>
  : StaticOutputRefByKind<TFallbackSpec, TKind>

type ResolveOutputRefForCall<
  TOutputOption,
  TCallInputs extends Record<string, unknown>,
  TFallbackSpec extends ComponentInputSpec,
  TKind extends ComponentKind,
> = TOutputOption extends FromInputComponentOutputOptions<infer TInputName>
  ? ResolveForwardedOutputRef<TInputName, TCallInputs, TFallbackSpec, TKind>
  : StaticOutputRefByKind<TFallbackSpec, TKind>

type ResolveOutputRefMapForCall<
  TOutputSpecs extends Record<string, ComponentInputSpec>,
  TOutputOptions extends Record<string, ComponentOutputOptions<TInputOptions>>,
  TInputOptions extends Record<string, ComponentInputOptions>,
  TCallInputs extends Record<string, unknown>,
  TKind extends ComponentKind,
> = {
  [K in keyof TOutputSpecs]: K extends keyof TOutputOptions
    ? [TOutputOptions[K]] extends [never]
      ? StaticOutputRefByKind<TOutputSpecs[K], TKind>
      : ResolveOutputRefForCall<TOutputOptions[K], TCallInputs, TOutputSpecs[K], TKind>
    : StaticOutputRefByKind<TOutputSpecs[K], TKind>
}

type IncludesAllExpectedTypes<
  TProvided extends Record<string, unknown>,
  TExpected extends Record<string, unknown>,
> = Exclude<keyof TExpected, keyof TProvided> extends never ? true : false

type ExtractProvidedInputTypes<TValue> = TValue extends RuntimeInput<infer TTypes, any>
  ? TTypes
  : TValue extends Array<infer TItem>
    ? ExtractProvidedInputTypes<TItem>
    : never

type ValidateProvidedInputValue<TValue, TExpectedSpec extends ComponentInputSpec> = [
  ExtractProvidedInputTypes<TValue>,
] extends [never]
  ? TValue
  : ExtractProvidedInputTypes<TValue> extends infer TProvidedTypes
    ? TProvidedTypes extends Record<string, unknown>
      ? IncludesAllExpectedTypes<
          TProvidedTypes,
          TExpectedSpec[0][typeof implementedTypes]
        > extends true
        ? TValue
        : never
      : never
    : never

type ValidateCallInputs<
  TCallInputs extends Record<string, unknown>,
  TInputSpecs extends Record<string, ComponentInputSpec>,
> = {
  [K in keyof TCallInputs]: K extends keyof TInputSpecs
    ? ValidateProvidedInputValue<TCallInputs[K], TInputSpecs[K]>
    : TCallInputs[K]
}

export const originalCreate = Symbol("originalCreate")
export const kind = Symbol("kind")

export type Component<
  TType extends VersionedName = VersionedName,
  TArgs extends Record<string, z.ZodType> = Record<string, never>,
  TInputs extends Record<string, ComponentInputSpec> = Record<string, never>,
  TOutputs extends Record<string, ComponentInputSpec> = Record<string, never>,
  TKind extends ComponentKind = "composite",
  TInputOptions extends Record<string, ComponentInputOptions> = Record<string, never>,
  TOutputOptions extends Record<string, ComponentOutputOptions<TInputOptions>> = Record<
    string,
    never
  >,
> = {
  /**
   * The type of the component.
   */
  type: TType

  /**
   * The non-generic model of the component.
   */
  model: ComponentModel

  /**
   * The entities used in the inputs or outputs of the component.
   */
  entities: Map<string, Entity>

  <TCallInputs extends InputSpecMapToInputRefMap<TInputs> = InputSpecMapToInputRefMap<TInputs>>(
    context: InputComponentParams<
      { [K in keyof TArgs]: z.input<TArgs[K]> },
      InputSpecMapToInputRefMap<TInputs>
    > & {
      inputs?: ValidateCallInputs<TCallInputs, TInputs>
    },
  ): ResolveOutputRefMapForCall<TOutputs, TOutputOptions, TInputOptions, TCallInputs, TKind>

  /**
   * The original create function.
   *
   * Used to calculate the definition hash.
   */
  [originalCreate]: (params: InputComponentParams<any, any>) => any
}

export function defineComponent<
  TType extends VersionedName = VersionedName,
  TArgs extends Record<string, ComponentArgumentOptions> = Record<string, never>,
  TInputs extends Record<string, ComponentInputOptions> = Record<string, never>,
  TOutputs extends Record<string, ComponentOutputOptions<TInputs>> = Record<string, never>,
  TKind extends ComponentKind = "composite",
>(
  options: ComponentOptions<TType, TArgs, TInputs, TOutputs> & { [kind]?: TKind },
): Component<
  TType,
  { [K in keyof TArgs]: ComponentArgumentOptionsToSchema<TArgs[K]> },
  { [K in keyof TInputs]: ComponentInputOptionsToSpec<TInputs[K]> },
  { [K in keyof TOutputs]: ComponentOutputOptionsToSpec<TOutputs[K], TInputs> },
  TKind,
  TInputs,
  TOutputs
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
  const mapOutput = createOutputMapper(options.inputs, entities)

  const model: ComponentModel = {
    type: options.type,
    kind: options[kind] ?? "composite",
    args: mapValues(options.args ?? {}, mapArgument),
    inputs: mapValues(options.inputs ?? {}, mapInput),
    outputs: mapValues(options.outputs ?? {}, mapOutput),
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

  type RuntimeCreateInputGroup =
    | RuntimeInput
    | InstanceInput
    | (Array<RuntimeCreateInputGroup> & Partial<{ [boundaryInput]: InstanceInput }>)

  function create(params: InputComponentParams<any, Record<string, RuntimeCreateInputGroup>>): any {
    const { name, args = {}, inputs } = params
    const instanceId = getInstanceId(options.type, name)

    const flatInputs: Record<string, RuntimeInput[]> = {}
    const tracedInputs: Record<string, InstanceInput[]> = {}
    const runtimeInputKey = (input: RuntimeInput): string => {
      if (input.provided) {
        return inputKey(input)
      }

      return `missing:${input[boundaryInput].instanceId}:${input[boundaryInput].output}`
    }

    for (const [key, inputGroup] of Object.entries(inputs ?? {})) {
      if (!(key in model.inputs)) {
        continue
      }

      if (!inputGroup) {
        continue
      }

      if (!Array.isArray(inputGroup)) {
        const normalizedInput = normalizeIncomingInput(inputGroup, key)
        tracedInputs[key] = [normalizedInput[boundaryInput]]
        flatInputs[key] = [normalizedInput]
        continue
      }

      const { group, inputs } = normalizeIncomingInputGroup(inputGroup, key)

      tracedInputs[key] = uniqueBy(group, inputKey)
      flatInputs[key] = uniqueBy(inputs, runtimeInputKey)
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
        resolvedInputs: mapValues(flatInputs, inputs => {
          return inputs
            .filter(input => input.provided)
            .map(input => ({
              instanceId: input.instanceId,
              output: input.output,
              ...(input.path ? { path: input.path } : {}),
            }))
        }),
      },
      () => {
        const markedInputs = mapValues(model.inputs, (componentInput, key) => {
          if (!componentInput.multiple) {
            const input = flatInputs[key]?.[0]

            if (input?.provided) {
              return createDeepOutputAccessor({
                ...input,
                [boundaryInput]: { instanceId: instanceId, output: key },
              })
            }

            return createNonProvidedInput({ instanceId: instanceId, output: key })
          }

          const inputs = (flatInputs[key] ?? []).filter(isProvidedRuntimeInput).map(input =>
            createDeepOutputAccessor({
              ...input,
              [boundaryInput]: { instanceId: instanceId, output: key },
            }),
          )

          const multipleBoundary = { instanceId, output: key }
          return createMultipleInputAccessor(inputs, multipleBoundary)
        })

        const outputs: Record<string, RuntimeInput | MultipleInput | null | undefined> =
          options.create({
            id: instanceId,
            name,
            args: processArgs(instanceId, create.model, args) as any,
            inputs: markedInputs as any,
          }) ?? {}

        const normalizedOutputs = normalizeCreateOutputs(outputs, model, instanceId)

        return withDeepOutputAccessors(normalizedOutputs, model, instanceId)
      },
    )

    function normalizeIncomingInput(
      input: RuntimeInput | InstanceInput,
      inputName: string,
    ): RuntimeInput {
      if (isStableInstanceInput(input)) {
        return createInput(input)
      }

      const runtimeInput = input as RuntimeInput

      if (runtimeInput.provided) {
        const inputBoundary = runtimeInput[boundaryInput] ?? {
          instanceId: runtimeInput.instanceId,
          output: runtimeInput.output,
          ...(runtimeInput.path ? { path: runtimeInput.path } : {}),
        }

        return createInput(runtimeInput, { boundary: inputBoundary })
      }

      return createNonProvidedInput(
        runtimeInput[boundaryInput] ?? { instanceId, output: inputName },
      )
    }

    function normalizeIncomingInputGroup(
      inputGroup: RuntimeCreateInputGroup,
      inputName: string,
    ): { group: InstanceInput[]; inputs: RuntimeInput[] } {
      const group: InstanceInput[] = []
      const inputs: RuntimeInput[] = []

      const visit = (value: RuntimeCreateInputGroup): void => {
        if (Array.isArray(value)) {
          const arrayBoundary = (value as Partial<{ [boundaryInput]: InstanceInput }>)[
            boundaryInput
          ]

          if (arrayBoundary) {
            group.push(arrayBoundary)
          }

          for (const item of value) {
            if (!item) {
              continue
            }

            visit(item)
          }

          return
        }

        const normalizedInput = normalizeIncomingInput(value, inputName)
        group.push(normalizedInput[boundaryInput])
        inputs.push(normalizedInput)
      }

      visit(inputGroup)

      return { group, inputs }
    }
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

function withDeepOutputAccessors(
  outputs: Record<string, RuntimeInput[]>,
  model: ComponentModel,
  instanceId: InstanceId,
): Record<string, RuntimeInput | MultipleInput> {
  return mapValues(outputs, (outputGroup, outputName) => {
    const outputSpec = model.outputs[outputName]
    if (!outputSpec) {
      return outputGroup[0]!
    }

    const normalizedOutputs = outputGroup.map(output => createDeepOutputAccessor(output))

    if (outputSpec.multiple) {
      return createMultipleInputAccessor(normalizedOutputs, {
        instanceId,
        output: outputName,
      })
    }

    return normalizedOutputs[0]!
  })
}

function isProvidedRuntimeInput(input: RuntimeInput): input is RequiredInput {
  return input.provided
}

function normalizeCreateOutputGroup(
  outputGroup: RuntimeInput | InstanceInput | Array<RuntimeInput | InstanceInput>,
  instanceId: InstanceId,
  outputName: string,
): RuntimeInput[] {
  return [outputGroup]
    .flat(2)
    .filter(isNonNullish)
    .map(output => {
      if (isStableInstanceInput(output)) {
        return createInput(output)
      }

      const runtimeOutput = output as RuntimeInput

      if (runtimeOutput.provided) {
        const stableBoundary = runtimeOutput[boundaryInput] ?? {
          instanceId: runtimeOutput.instanceId,
          output: runtimeOutput.output,
          ...(runtimeOutput.path ? { path: runtimeOutput.path } : {}),
        }

        return createInput(runtimeOutput, { boundary: stableBoundary })
      }

      return createNonProvidedInput(
        runtimeOutput[boundaryInput] ?? { instanceId, output: outputName },
      )
    })
}

function normalizeCreateOutputs(
  outputs: Record<string, RuntimeInput | MultipleInput | null | undefined>,
  model: ComponentModel,
  instanceId: InstanceId,
): Record<string, RuntimeInput[]> {
  const normalizedOutputs: Record<string, RuntimeInput[]> = {}

  for (const [outputName, outputSpec] of Object.entries(model.outputs)) {
    const outputGroup = outputs[outputName]

    if (!isNonNullish(outputGroup)) {
      if (model.kind === "unit") {
        throw new Error(`Unit output "${outputName}" in instance "${instanceId}" must be provided`)
      }

      normalizedOutputs[outputName] = outputSpec.multiple
        ? []
        : [createNonProvidedInput({ instanceId, output: outputName })]
      continue
    }

    const normalizedGroup = normalizeCreateOutputGroup(outputGroup, instanceId, outputName)

    if (outputSpec.multiple && normalizedGroup.some(output => !output.provided)) {
      throw new Error(
        `Multiple output "${outputName}" in instance "${instanceId}" cannot contain non-provided items`,
      )
    }

    if (model.kind === "unit") {
      if (normalizedGroup.length === 0 || normalizedGroup.some(output => !output.provided)) {
        throw new Error(`Unit output "${outputName}" in instance "${instanceId}" must be provided`)
      }
    }

    normalizedOutputs[outputName] =
      outputSpec.multiple || normalizedGroup.length > 0
        ? normalizedGroup
        : [createNonProvidedInput({ instanceId, output: outputName })]
  }

  for (const [outputName, outputGroup] of Object.entries(pickBy(outputs, isNonNullish))) {
    if (!(outputName in model.outputs) || outputName in normalizedOutputs) {
      continue
    }

    normalizedOutputs[outputName] = normalizeCreateOutputGroup(outputGroup, instanceId, outputName)
  }

  return normalizedOutputs
}

function isStableInstanceInput(value: unknown): value is InstanceInput {
  if (!value || typeof value !== "object") {
    return false
  }

  if ("provided" in value) {
    return false
  }

  const input = value as Partial<InstanceInput>

  return typeof input.instanceId === "string" && typeof input.output === "string"
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
      schema: z.toJSONSchema(value.schema, {
        target: "draft-7",
        io: "input",
        unrepresentable: "any",
      }),
      [runtimeSchema]: value.schema,
      required: !isSchemaOptional(value.schema),
      meta: {
        ...value.meta,
        title: value.meta?.title || camelCaseToHumanReadable(key),
      },
    }
  }

  return {
    schema: z.toJSONSchema(value, { target: "draft-7", io: "input", unrepresentable: "any" }),
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

function isFromInputOutputOptions(
  value: ComponentOutputOptions,
): value is FromInputComponentOutputOptions {
  return typeof value === "object" && value !== null && "fromInput" in value
}

function createOutputMapper(
  inputs: Record<string, ComponentInputOptions> | undefined,
  entities: Map<string, Entity>,
) {
  const mapInput = createInputMapper(entities)

  return (value: ComponentOutputOptions, key: string): ComponentInput => {
    if (!isFromInputOutputOptions(value)) {
      return mapInput(value, key)
    }

    const sourceInput = inputs?.[value.fromInput]
    if (!sourceInput) {
      throw new Error(
        `Output "${key}" references missing input "${value.fromInput}" via fromInput.`,
      )
    }

    const mappedInput = mapInput(sourceInput, value.fromInput)

    return {
      ...mappedInput,
      fromInput: value.fromInput,
      meta: {
        ...mappedInput.meta,
        ...value.meta,
        title: value.meta?.title || camelCaseToHumanReadable(key),
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

type ToFullComponentOutputOptions<T extends Record<string, ComponentOutputOptions>> = Simplify<{
  [K in keyof T]: T[K] extends Entity ? { entity: T[K] } : T[K]
}>

function toFullComponentOutputOptions<T extends Record<string, ComponentOutputOptions>>(
  outputs: T,
): ToFullComponentOutputOptions<T> {
  return mapValues(outputs, output => {
    if (typeof output !== "object" || output === null) {
      return { entity: output }
    }

    if ("entity" in output || "fromInput" in output) {
      return output
    }

    return { entity: output }
  }) as any
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
export function $outputs<T extends Record<string, ComponentOutputOptions>>(
  outputs: T,
): ToFullComponentOutputOptions<T> {
  return toFullComponentOutputOptions(outputs)
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
