/** biome-ignore-all lint/suspicious/noExplicitAny: maybe fix later */

import type { InstanceInput } from "./instance"
import type { VersionedName } from "./meta"
import { mapValues } from "remeda"
import { z } from "zod"
import {
  type Component,
  type ComponentArgumentOptions,
  type ComponentArgumentOptionsToSchema,
  type ComponentInputOptions,
  type ComponentInputOptionsToSpec,
  type ComponentInputSpec,
  type ComponentModel,
  type ComponentOptions,
  componentArgumentSchema,
  componentModelSchema,
  defineComponent,
  type FullComponentArgumentOptions,
  kind,
  mapArgument,
  type ToFullComponentArgumentOptions,
  toFullComponentArgumentOptions,
} from "./component"

export const componentSecretSchema = componentArgumentSchema.extend({
  /**
   * The secret cannot be modified by the user, but can be modified by the unit.
   */
  readonly: z.boolean(),

  /**
   * The secret value is computed by the unit and should not be passed to it when invoked.
   */
  computed: z.boolean(),
})

export type ComponentSecret = z.infer<typeof componentSecretSchema>

export type FullComponentSecretOptions = FullComponentArgumentOptions & {
  readonly?: boolean
  computed?: boolean
}

export type ComponentSecretOptions = z.ZodType | FullComponentSecretOptions

type UnitOptions<
  TType extends VersionedName,
  TArgs extends Record<string, ComponentArgumentOptions>,
  TInputs extends Record<string, ComponentInputOptions>,
  TOutputs extends Record<string, ComponentInputOptions>,
  TSecrets extends Record<string, ComponentSecretOptions>,
> = Omit<ComponentOptions<TType, TArgs, TInputs, TOutputs>, "create"> & {
  source: UnitSource

  secrets?: TSecrets
}

export const unitSourceSchema = z.object({
  /**
   * The package where the unit implementation is located.
   *
   * May be both: local monorepo package or a remote NPM package.
   */
  package: z.string(),

  /**
   * The path to the unit implementation within the package.
   *
   * If not provided, the root of the package is assumed.
   */
  path: z.string().optional(),
})

export const unitModelSchema = z.object({
  ...componentModelSchema.shape,

  /**
   * The source of the unit.
   */
  source: unitSourceSchema,

  /**
   * The record of the secret specs.
   */
  secrets: z.record(z.string(), componentSecretSchema),
})

export type UnitModel = z.infer<typeof unitModelSchema>
export type UnitSource = z.infer<typeof unitSourceSchema>

declare const secrets: unique symbol

export type Unit<
  TType extends VersionedName = VersionedName,
  TArgs extends Record<string, z.ZodType> = Record<string, never>,
  TInputs extends Record<string, ComponentInputSpec> = Record<string, never>,
  TOutputs extends Record<string, ComponentInputSpec> = Record<string, never>,
  TSecrets extends Record<string, unknown> = Record<string, never>,
> = Component<TType, TArgs, TInputs, TOutputs> & {
  /**
   * Holds the type of the unit secrets.
   *
   * Does not exist at runtime, only for type checking.
   */
  [secrets]: TSecrets

  /**
   * The model of the unit.
   */
  model: UnitModel
}

export function defineUnit<
  TType extends VersionedName = VersionedName,
  TArgs extends Record<string, ComponentArgumentOptions> = Record<string, never>,
  TInputs extends Record<string, ComponentInputOptions> = Record<string, never>,
  TOutputs extends Record<string, ComponentInputOptions> = Record<string, never>,
  TSecrets extends Record<string, ComponentSecretOptions> = Record<string, never>,
>(
  options: UnitOptions<TType, TArgs, TInputs, TOutputs, TSecrets>,
): Unit<
  TType,
  { [K in keyof TArgs]: ComponentArgumentOptionsToSchema<TArgs[K]> },
  { [K in keyof TInputs]: ComponentInputOptionsToSpec<TInputs[K]> },
  { [K in keyof TOutputs]: ComponentInputOptionsToSpec<TOutputs[K]> },
  { [K in keyof TSecrets]: ComponentArgumentOptionsToSchema<TSecrets[K]> }
> {
  if (!options.source) {
    throw new Error("Unit source is required")
  }

  const component = defineComponent<TType, TArgs, TInputs, TOutputs>({
    ...options,
    [kind]: "unit",

    create({ id }) {
      const outputs: Record<string, InstanceInput[]> = {}
      for (const key in options.outputs ?? {}) {
        outputs[key] = [
          {
            instanceId: id,
            output: key,
          },
        ]
      }

      return outputs as any
    },
  }) as any

  try {
    component.model.source = options.source ?? {}
    component.model.secrets = mapValues(options.secrets ?? {}, mapSecret)
  } catch (error) {
    throw new Error(`Failed to map secrets for unit "${options.type}"`, { cause: error })
  }

  return component
}

/**
 * The helper marker for component secrets.
 *
 * Helps validating secrets types and gives the compiler a hint for generating `meta` fields.
 */
export function $secrets<T extends Record<string, ComponentArgumentOptions>>(
  secrets: T,
): ToFullComponentArgumentOptions<T> {
  return toFullComponentArgumentOptions(secrets)
}

function mapSecret(value: ComponentSecretOptions, key: string): ComponentSecret {
  if ("schema" in value) {
    return {
      ...mapArgument(value, key),
      readonly: value.readonly ?? false,
      computed: value.computed ?? false,
    }
  }

  return {
    ...mapArgument(value, key),
    readonly: false,
    computed: false,
  }
}

/**
 * Checks if the given model is a unit model.
 *
 * @param model The model to check.
 *
 * @returns `true` if the model is a unit model, `false` otherwise.
 */
export function isUnitModel(model: ComponentModel): model is UnitModel {
  return "source" in model
}
