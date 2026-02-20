/** biome-ignore-all lint/suspicious/noExplicitAny: здесь орать запрещено */

import type { IsEmptyObject } from "type-fest"
import { pathToFileURL } from "node:url"
import {
  type ComponentInput,
  type ComponentInputSpec,
  camelCaseToHumanReadable,
  HighstateConfigKey,
  type InstanceStatusField,
  type InstanceStatusFieldValue,
  type PartialKeys,
  parseArgumentValue,
  parseInstanceId,
  runtimeSchema,
  type TriggerInvocation,
  type Unit,
  type UnitArtifact,
  type UnitConfig,
  type UnitInputValue,
  type UnitPage,
  type UnitTerminal,
  type UnitTrigger,
  type UnitWorker,
  unitArtifactSchema,
  unitConfigSchema,
  type VersionedName,
  z,
} from "@highstate/contract"
import {
  Config,
  type Input,
  type Output,
  output,
  secret as pulumiSecret,
  type Unwrap,
} from "@pulumi/pulumi"
import { mapValues } from "remeda"
import { type DeepInput, toPromise } from "./utils"

type StatusField<TArgName extends string = string> = Omit<
  InstanceStatusField,
  "complementaryTo" | "meta"
> & {
  meta?: PartialKeys<InstanceStatusField["meta"], "title">
  complementaryTo?: TArgName
}

type ExtraOutputs<TArgName extends string = string> = {
  $statusFields?:
    | Input<
        Record<
          string,
          DeepInput<Omit<StatusField<TArgName>, "name"> | InstanceStatusFieldValue | undefined>
        >
      >
    | Input<DeepInput<StatusField<TArgName> | undefined>[]>

  $terminals?:
    | Input<Record<string, DeepInput<Omit<UnitTerminal, "name"> | undefined>>>
    | Input<DeepInput<UnitTerminal | undefined>[]>

  $pages?:
    | Input<Record<string, DeepInput<Omit<UnitPage, "name"> | undefined>>>
    | Input<DeepInput<UnitPage | undefined>[]>

  $triggers?:
    | Input<Record<string, DeepInput<Omit<UnitTrigger, "name"> | undefined>>>
    | Input<DeepInput<UnitTrigger | undefined>[]>

  $workers?:
    | Input<Record<string, DeepInput<Omit<UnitWorker, "name"> | undefined>>>
    | Input<DeepInput<UnitWorker | undefined>[]>
}

type OutputMapToDeepInputMap<
  T extends Record<string, unknown>,
  TArgName extends string,
> = IsEmptyObject<T> extends true
  ? ExtraOutputs
  : { [K in keyof T]: DeepInput<T[K]> } & ExtraOutputs<TArgName>

interface UnitContext<
  TArgs extends Record<string, unknown>,
  TInputs extends Record<string, unknown>,
  TOutputs extends Record<string, unknown>,
  TSecrets extends Record<string, unknown>,
> {
  args: TArgs
  instanceId: string
  type: string
  name: string

  secrets: {
    [K in keyof TSecrets]: undefined extends TSecrets[K]
      ? Output<NonNullable<TSecrets[K]>> | undefined
      : Output<TSecrets[K]>
  }

  getSecret<K extends keyof TSecrets>(
    this: void,
    name: K,
  ): Output<NonNullable<TSecrets[K]> | undefined>

  getSecret<K extends keyof TSecrets>(
    this: void,
    name: K,
    factory: () => Input<NonNullable<TSecrets[K]>>,
  ): Output<NonNullable<TSecrets[K]>>

  setSecret<K extends keyof TSecrets>(
    this: void,
    name: K,
    value: Input<NonNullable<TSecrets[K]>>,
  ): void

  inputs: TInputs
  invokedTriggers: TriggerInvocation[]

  outputs(
    this: void,
    outputs?: OutputMapToDeepInputMap<TOutputs, keyof TArgs & string>,
  ): Promise<unknown>
}

// z.output since the values are validated/transformed and passed to the user
type InputSpecToWrappedValue<T extends ComponentInputSpec> = T[2] extends true
  ? // we have to wrap the array in Output since we don't know how many items will be returned by each multiple input
    Output<NonNullable<z.output<T[0]["schema"]>>[]>
  : T[1] extends true
    ? Output<NonNullable<z.output<T[0]["schema"]>>>
    : Output<NonNullable<z.output<T[0]["schema"]>>> | undefined

// z.input since the values are passed from the user and should be validated/transformed before returning from the unit
type OutputSpecToValue<T extends ComponentInputSpec> = T[2] extends true
  ? T[1] extends true
    ? NonNullable<z.input<T[0]["schema"]>>[]
    : NonNullable<z.input<T[0]["schema"]>>[] | undefined
  : T[1] extends true
    ? NonNullable<z.input<T[0]["schema"]>>
    : NonNullable<z.input<T[0]["schema"]>> | undefined

let instanceId: string | undefined
let instanceName: string | undefined
let importBaseUrl: URL | undefined

/**
 * Returns the current unit instance id.
 *
 * Only available after calling `forUnit` function.
 */
export function getUnitInstanceId(): string {
  if (!instanceId) {
    throw new Error(`Instance id is not set. Did you call "forUnit" function?`)
  }

  return instanceId
}

/**
 * Returns the current unit instance name.
 */
export function getUnitInstanceName(): string {
  if (!instanceName) {
    throw new Error(`Instance name is not set. Did you call "forUnit" function?`)
  }

  return instanceName
}

/**
 * Returns the base URL for dynamic imports.
 */
export function getImportBaseUrl(): URL {
  if (!importBaseUrl) {
    throw new Error(`Import base URL is not set. Did you call "forUnit" function?`)
  }

  return importBaseUrl
}

/**
 * Returns a comment that can be used in resources to indicate that they are managed by Highstate.
 */
export function getResourceComment(): string {
  return `Managed by Highstate (${getUnitInstanceId()})`
}

function getOutputValue(
  unit: Unit,
  inputName: string,
  input: ComponentInput,
  entries: UnitInputValue[],
) {
  const entity = unit.entities.get(input.type)
  if (!entity) {
    throw new Error(`Entity "${input.type}" not found in the unit "${unit.model.type}".`)
  }

  const _validateValue = (entry: UnitInputValue) => {
    return output(entry.value).apply(value => {
      const schema = Array.isArray(value) ? entity.schema.array() : entity.schema
      const result = schema.safeParse(value)

      if (!result.success) {
        throw new Error(
          `Invalid value for input "${inputName}": ${z.prettifyError(result.error)}`,
        )
      }

      if (Array.isArray(value)) {
        return value
      }

      return input.multiple ? [value] : value
    })
  }

  const values = output(entries.map(_validateValue)).apply(values => values.flat())

  if (!input.multiple) {
    return values.apply(values => values[0])
  }

  return values
}

export function forUnit<
  TType extends VersionedName,
  TArgs extends Record<string, z.ZodType>,
  TInputs extends Record<string, ComponentInputSpec>,
  TOutputs extends Record<string, ComponentInputSpec>,
  TSecrets extends Record<string, z.ZodType>,
>(
  unit: Unit<TType, TArgs, TInputs, TOutputs, TSecrets>,
): UnitContext<
  { [K in keyof TArgs]: z.output<TArgs[K]> },
  { [K in keyof TInputs]: InputSpecToWrappedValue<TInputs[K]> },
  { [K in keyof TOutputs]: OutputSpecToValue<TOutputs[K]> },
  { [K in keyof TSecrets]: z.output<TSecrets[K]> }
> {
  const config = new Config()
  const rawHSConfig = config.requireObject(HighstateConfigKey.Config)
  const hsConfig = unitConfigSchema.parse(rawHSConfig)

  const rawHsSecrets = config
    .requireSecretObject(HighstateConfigKey.Secrets)
    .apply(secrets => z.record(z.string(), z.unknown()).parse(secrets))

  const args = mapValues(unit.model.args, (arg, argName) => {
    const value = parseArgumentValue(hsConfig.args[argName])
    const result = arg[runtimeSchema]!.safeParse(value)

    if (!result.success) {
      throw new Error(`Invalid argument "${argName}": ${z.prettifyError(result.error)}`)
    }

    return result.data
  })

  const secrets = mapValues(unit.model.secrets, (secret, secretName) => {
    const hasValue = hsConfig.secretNames.includes(secretName)

    if (!hasValue && !secret.required) {
      return secret.schema.default ? pulumiSecret(secret.schema.default) : undefined
    }

    if (!hasValue && secret.required) {
      throw new Error(`Secret "${secretName}" is required but not provided.`)
    }

    return rawHsSecrets[secretName].apply(rawValue => {
      const value = parseArgumentValue(rawValue)
      const result = secret[runtimeSchema]!.safeParse(value)

      if (!result.success) {
        throw new Error(`Invalid secret "${secretName}": ${z.prettifyError(result.error)}`)
      }

      return pulumiSecret(result.data)
    })
  })

  const inputs = mapValues(unit.model.inputs, (input, inputName) => {
    const value = hsConfig.inputs[inputName]

    if (!value) {
      if (input.multiple) {
        return output([])
      }

      return undefined
    }

    return getOutputValue(unit as unknown as Unit, inputName, input, value)
  })

  const [type, name] = parseInstanceId(hsConfig.instanceId)

  instanceId = hsConfig.instanceId
  instanceName = name
  importBaseUrl = pathToFileURL(hsConfig.importBasePath)

  return {
    instanceId: hsConfig.instanceId,
    type,
    name,

    args: args as any,
    secrets: secrets as any,
    inputs: inputs as any,
    invokedTriggers: hsConfig.invokedTriggers,

    getSecret: (<K extends keyof TSecrets>(
      name: K,
      factory?: () => Input<NonNullable<TSecrets[K]>>,
    ) => {
      if (!factory) {
        return secrets[name as string]
      }

      const value = secrets[name as string] ?? pulumiSecret(factory())
      secrets[name as string] = value

      return value
    }) as any,

    setSecret: ((name: keyof TSecrets, value: Input<NonNullable<TSecrets[keyof TSecrets]>>) => {
      secrets[name as string] = pulumiSecret(value)
    }) as any,

    outputs: async (outputs: any = {}) => {
      const result: any = mapValues(outputs, (outputValue, outputName) => {
        if (outputName === "$statusFields") {
          return output(outputValue).apply(mapStatusFields)
        }

        if (outputName === "$pages") {
          return output(outputValue).apply(mapPages)
        }

        if (outputName === "$terminals") {
          return output(outputValue).apply(mapTerminals)
        }

        if (outputName === "$triggers") {
          return output(outputValue).apply(mapTriggers)
        }

        if (outputName === "$workers") {
          return output(outputValue).apply(mapWorkers)
        }

        if (outputName.startsWith("$")) {
          throw new Error(`Unknown extra output "${outputName}".`)
        }

        const outputModel = unit.model.outputs[outputName]
        if (!outputModel) {
          throw new Error(
            `Output "${outputName}" not found in the unit "${unit.model.type}", but was passed to outputs(...).`,
          )
        }

        const entity = unit.entities.get(outputModel.type)
        if (!entity) {
          throw new Error(
            `Entity "${outputModel.type}" not found in the unit "${unit.model.type}". It looks like a bug in the unit definition.`,
          )
        }

        return output(outputValue).apply(value => {
          const schema = outputModel.multiple ? entity.schema.array() : entity.schema
          const result = schema.safeParse(value)

          if (!result.success) {
            throw new Error(
              `Invalid value for output "${outputName}" of type "${outputModel.type}": ${z.prettifyError(
                result.error,
              )}`,
            )
          }

          return result.data
        })
      })

      // wait for all outputs to resolve before collecting secrets and artifacts
      await Promise.all(Object.values(result).map(o => toPromise(o)))

      result.$secrets = secrets

      // collect artifacts from all outputs
      const artifactsMap: Record<string, UnitArtifact[]> = {}
      for (const [outputName, outputValue] of Object.entries(outputs)) {
        const resolvedValue = await toPromise(outputValue)
        const artifacts = extractObjectsFromValue(unitArtifactSchema, resolvedValue)
        if (artifacts.length > 0) {
          artifactsMap[outputName] = artifacts
        }
      }

      if (Object.keys(artifactsMap).length > 0) {
        result.$artifacts = artifactsMap
      }

      return result
    },
  }
}

function mapStatusFields(status: Unwrap<ExtraOutputs["$statusFields"]>): InstanceStatusField[] {
  if (!status) {
    return []
  }

  if (Array.isArray(status)) {
    return status
      .filter((field): field is NonNullable<StatusField> => field?.value !== undefined)
      .map(field => {
        return {
          name: field.name,
          meta: {
            title: field.meta?.title ?? camelCaseToHumanReadable(field.name),
          },
          value: field.value,
        }
      })
  }

  return Object.entries(status)
    .map(([name, field]) => {
      if (!field) {
        return undefined
      }

      if (
        typeof field === "string" ||
        typeof field === "number" ||
        typeof field === "boolean" ||
        Array.isArray(field)
      ) {
        return {
          name,
          meta: {
            title: camelCaseToHumanReadable(name),
          },
          value: field,
        }
      }

      return {
        ...field,
        meta: {
          ...field.meta,
          title: field.meta?.title ?? camelCaseToHumanReadable(name),
        },
        name,
      }
    })
    .filter((field): field is InstanceStatusField => field?.value !== undefined)
}

function mapPages(pages: Unwrap<ExtraOutputs["$pages"]>): Output<UnitPage[]> {
  if (!pages) {
    return output([])
  }

  if (!Array.isArray(pages)) {
    pages = Object.entries(pages).map(([name, page]) => {
      if (!page) {
        return undefined
      }

      return { ...page, name }
    })
  }

  return output(pages.filter((page): page is NonNullable<UnitPage> => !!page))
}

function mapTerminals(terminals: Unwrap<ExtraOutputs["$terminals"]>): Output<UnitTerminal[]> {
  if (!terminals) {
    return output([])
  }

  if (!Array.isArray(terminals)) {
    terminals = Object.entries(terminals).map(([name, terminal]) => {
      if (!terminal) {
        return undefined
      }

      return { ...terminal, name }
    })
  }

  return output(terminals.filter((terminal): terminal is NonNullable<UnitTerminal> => !!terminal))
}

function mapTriggers(triggers: Unwrap<ExtraOutputs["$triggers"]>): Output<UnitTrigger[]> {
  if (!triggers) {
    return output([])
  }

  if (!Array.isArray(triggers)) {
    triggers = Object.entries(triggers).map(([name, trigger]) => {
      if (!trigger) {
        return undefined
      }

      return { ...trigger, name }
    })
  }

  return output(triggers.filter((trigger): trigger is NonNullable<UnitTrigger> => !!trigger))
}

function mapWorkers(workers: Unwrap<ExtraOutputs["$workers"]>): Output<Unwrap<UnitWorker>[]> {
  if (!workers) {
    return output([])
  }

  if (!Array.isArray(workers)) {
    workers = Object.entries(workers).map(([name, worker]) => {
      if (!worker) {
        return undefined
      }

      return { ...worker, name }
    })
  }

  return output(workers.filter((worker): worker is NonNullable<Unwrap<UnitWorker>> => !!worker))
}

/**
 * Extracts all objects with the specified schema from a value.
 */
function extractObjectsFromValue<TSchema extends z.ZodType>(
  schema: TSchema,
  data: unknown,
): z.infer<TSchema>[] {
  const result: z.infer<TSchema>[] = []

  function traverse(obj: unknown): void {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item)
      }
      return
    }

    const parseResult = schema.safeParse(obj)
    if (parseResult.success) {
      result.push(parseResult.data)
      return
    }

    // recursively traverse all properties
    for (const value of Object.values(obj)) {
      traverse(value)
    }
  }

  traverse(data)
  return result
}
