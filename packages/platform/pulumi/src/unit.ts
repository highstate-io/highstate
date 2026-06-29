/** biome-ignore-all lint/suspicious/noExplicitAny: здесь орать запрещено */

import type { IsEmptyObject } from "type-fest"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  type ComponentInput,
  type ComponentInputSpec,
  camelCaseToHumanReadable,
  type EntityValue,
  type EntityValueInput,
  type InstanceStatusField,
  type InstanceStatusFieldValue,
  type PartialKeys,
  parseArgumentValue,
  parseInstanceId,
  runtimeSchema,
  type TriggerInvocation,
  type Unit,
  type UnitArtifact,
  type UnitInputValue,
  type UnitPage,
  type UnitTerminal,
  type UnitTrigger,
  type UnitWorker,
  unitArtifactSchema,
  type VersionedName,
  z,
} from "@highstate/contract"
import { type Input, type Output, secret as pulumiSecret, type Unwrap } from "@pulumi/pulumi"
import { mapValues } from "remeda"
import { getHasResourceHooks } from "./resource-hooks"
import {
  getHighstateRuntime,
  highstateRuntimeEndpointEnvVar,
  highstateRuntimeTokenEnvVar,
  isHighstateRuntimeAvaiable,
} from "./runtime"
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
  : {
      [K in keyof T as undefined extends T[K] ? never : K]: DeepInput<T[K]>
    } & {
      [K in keyof T as undefined extends T[K] ? K : never]?: DeepInput<T[K]>
    } & ExtraOutputs<TArgName>

interface UnitContext<
  TArgs extends Record<string, unknown>,
  TInputs extends Record<string, unknown>,
  TOutputs extends Record<string, unknown>,
  TSecrets extends Record<string, unknown>,
> {
  args: TArgs
  instanceId: string
  stateId: string
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
  ): Promise<void>
}

// z.output since the values are validated/transformed and passed to the user
type InputSpecToWrappedValue<T extends ComponentInputSpec> = T[2] extends true
  ? NonNullable<EntityValue<T[0]>>[]
  : T[1] extends true
    ? NonNullable<EntityValue<T[0]>>
    : NonNullable<EntityValue<T[0]>> | undefined

// z.input since the values are passed from the user and should be validated/transformed before returning from the unit
type OutputSpecToValue<T extends ComponentInputSpec> = T[2] extends true
  ? T[1] extends true
    ? NonNullable<EntityValueInput<T[0]>>[]
    : NonNullable<EntityValueInput<T[0]>>[] | undefined
  : T[1] extends true
    ? NonNullable<EntityValueInput<T[0]>>
    : NonNullable<EntityValueInput<T[0]>> | undefined

let instanceId: string | undefined
let stateId: string | undefined
let instanceName: string | undefined
let importBaseUrl: URL | undefined
const hsConfig = isHighstateRuntimeAvaiable ? await getHighstateRuntime().config.get() : undefined

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
 * Returns the current unit instance state id.
 *
 * The state id is provided by the runner via Pulumi config.
 * Only available after calling `forUnit` function.
 */
export function getUnitStateId(): string {
  if (!stateId) {
    throw new Error(`State id is not set. Did you call "forUnit" function?`)
  }

  return stateId
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
  return `Managed by Highstate [${getUnitStateId()}]`
}

function getInputValue(
  unit: Unit,
  inputName: string,
  input: ComponentInput,
  entries: UnitInputValue[],
) {
  const entity = unit.entities.get(input.type)
  if (!entity) {
    throw new Error(`Entity "${input.type}" not found in the unit "${unit.model.type}".`)
  }

  const values = entries.flatMap(entry => {
    const value = parseArgumentValue(entry.value)
    const schema = Array.isArray(value) ? entity.schema.array() : entity.schema
    const result = schema.safeParse(value)

    if (!result.success) {
      throw new Error(`Invalid value for input "${inputName}": ${z.prettifyError(result.error)}`)
    }

    if (Array.isArray(result.data)) {
      return result.data
    }

    return input.multiple ? [result.data] : [result.data]
  })

  if (!input.multiple) {
    return values[0]
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
  if (!hsConfig) {
    throw new Error(
      `Runtime config is required. Set "${highstateRuntimeEndpointEnvVar}" and "${highstateRuntimeTokenEnvVar}".`,
    )
  }

  const args = mapValues(unit.model.args, (arg, argName) => {
    const value = parseArgumentValue(hsConfig.args[argName])
    const result = arg[runtimeSchema]!.safeParse(value)

    if (!result.success) {
      throw new Error(`Invalid argument "${argName}": ${z.prettifyError(result.error)}`)
    }

    return result.data
  })

  const secrets = mapValues(unit.model.secrets, (secret, secretName) => {
    const hasValue = secretName in hsConfig.secretValues

    if (!hasValue && !secret.required) {
      return secret.schema.default ? pulumiSecret(secret.schema.default) : undefined
    }

    if (!hasValue && secret.required) {
      throw new Error(`Secret "${secretName}" is required but not provided.`)
    }

    const rawValue = hsConfig.secretValues[secretName]
    const value = parseArgumentValue(rawValue)
    const result = secret[runtimeSchema]!.safeParse(value)

    if (!result.success) {
      throw new Error(`Invalid secret "${secretName}": ${z.prettifyError(result.error)}`)
    }

    return pulumiSecret(result.data)
  })

  const inputs = mapValues(unit.model.inputs, (input, inputName) => {
    const value = hsConfig.inputs[inputName]

    if (!value) {
      if (input.multiple) {
        return []
      }

      return undefined
    }

    return getInputValue(unit as unknown as Unit, inputName, input, value)
  })

  const [type, name] = parseInstanceId(hsConfig.instanceId)

  instanceId = hsConfig.instanceId
  stateId = hsConfig.stateId
  instanceName = name
  importBaseUrl = pathToFileURL(hsConfig.importBasePath)

  return {
    instanceId: hsConfig.instanceId,
    stateId: hsConfig.stateId,
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
      const resolvedOutputs = await toPromise(outputs)
      const resolvedOutputEntries = Object.entries(resolvedOutputs as Record<string, any>)

      const result: any = {}

      for (const [outputName, outputValue] of resolvedOutputEntries) {
        if (outputName === "$statusFields") {
          result[outputName] = mapStatusFields(outputValue)
          continue
        }

        if (outputName === "$pages") {
          result[outputName] = mapPages(outputValue)
          continue
        }

        if (outputName === "$terminals") {
          result[outputName] = mapTerminals(outputValue)
          continue
        }

        if (outputName === "$triggers") {
          result[outputName] = mapTriggers(outputValue)
          continue
        }

        if (outputName === "$workers") {
          result[outputName] = mapWorkers(outputValue)
          continue
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

        if (outputValue === undefined && !outputModel.required) {
          continue
        }

        const entity = unit.entities.get(outputModel.type)
        if (!entity) {
          throw new Error(
            `Entity "${outputModel.type}" not found in the unit "${unit.model.type}". It looks like a bug in the unit definition.`,
          )
        }

        const schema = outputModel.multiple ? entity.schema.array() : entity.schema
        const parseResult = schema.safeParse(outputValue)

        if (!parseResult.success) {
          throw new Error(
            `Invalid value for output "${outputName}" of type "${outputModel.type}": ${z.prettifyError(
              parseResult.error,
            )}`,
          )
        }

        result[outputName] = parseResult.data
      }

      result.$secrets = secrets

      // collect artifacts from all outputs
      const artifactsMap: Record<string, UnitArtifact[]> = {}
      for (const [outputName, outputValue] of resolvedOutputEntries) {
        const artifacts = extractObjectsFromValue(unitArtifactSchema, outputValue)
        if (artifacts.length > 0) {
          artifactsMap[outputName] = artifacts
        }
      }

      if (Object.keys(artifactsMap).length > 0) {
        result.$artifacts = artifactsMap
      }

      result.$hasResourceHooks = getHasResourceHooks()

      await getHighstateRuntime().result.submit(await toPromise(result))

      return undefined
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

function mapPages(pages: Unwrap<ExtraOutputs["$pages"]>): UnitPage[] {
  if (!pages) {
    return []
  }

  if (!Array.isArray(pages)) {
    pages = Object.entries(pages).map(([name, page]) => {
      if (!page) {
        return undefined
      }

      return { ...page, name }
    })
  }

  return pages.filter((page): page is NonNullable<UnitPage> => !!page)
}

function mapTerminals(terminals: Unwrap<ExtraOutputs["$terminals"]>): UnitTerminal[] {
  if (!terminals) {
    return []
  }

  if (!Array.isArray(terminals)) {
    terminals = Object.entries(terminals).map(([name, terminal]) => {
      if (!terminal) {
        return undefined
      }

      return { ...terminal, name }
    })
  }

  return terminals.filter((terminal): terminal is NonNullable<UnitTerminal> => !!terminal)
}

function mapTriggers(triggers: Unwrap<ExtraOutputs["$triggers"]>): UnitTrigger[] {
  if (!triggers) {
    return []
  }

  if (!Array.isArray(triggers)) {
    triggers = Object.entries(triggers).map(([name, trigger]) => {
      if (!trigger) {
        return undefined
      }

      return { ...trigger, name }
    })
  }

  return triggers.filter((trigger): trigger is NonNullable<UnitTrigger> => !!trigger)
}

function mapWorkers(workers: Unwrap<ExtraOutputs["$workers"]>): Unwrap<UnitWorker>[] {
  if (!workers) {
    return []
  }

  if (!Array.isArray(workers)) {
    workers = Object.entries(workers).map(([name, worker]) => {
      if (!worker) {
        return undefined
      }

      return { ...worker, name }
    })
  }

  return workers.filter((worker): worker is NonNullable<Unwrap<UnitWorker>> => !!worker)
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

/**
 * Returns a temporary file path for the current unit instance.
 *
 * The format is `/tmp/highstate/{stateId}`.
 * This directory does not change between different runs of the same unit instance.
 */
export function getUnitTempPath(): string {
  return join("/tmp/highstate", getUnitStateId())
}
