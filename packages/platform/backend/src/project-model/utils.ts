import type {
  HubInput,
  HubModel,
  HubModelPatch,
  InstanceId,
  InstanceInput,
  InstanceModel,
  InstanceModelPatch,
} from "@highstate/contract"
import type { InstanceArgumentPatchOperation } from "./abstractions"
import { isDeepStrictEqual } from "node:util"
import { yamlValueSchema } from "@highstate/contract"
import { parse, stringify } from "yaml"
import { ProjectModelArgumentPatchError } from "./errors"

type JsonContainer = Record<string, unknown> | unknown[]

/**
 * Applies ordered JSON Patch operations to an instance argument map.
 * YAML wrapper values are traversed as their parsed structure and reserialized after mutation.
 *
 * @param args The current instance argument map.
 * @param operations The ordered operations to apply.
 * @returns A patched copy of the argument map.
 */
export function patchInstanceArguments(
  args: Record<string, unknown>,
  operations: readonly InstanceArgumentPatchOperation[],
): Record<string, unknown> {
  let result = structuredClone(args)

  for (const [operationIndex, operation] of operations.entries()) {
    try {
      const tokens = parseJsonPointer(operation.path)

      if (tokens.length === 0) {
        if (operation.operation === "remove") {
          throw new PatchFailure("ROOT_REMOVAL_UNSUPPORTED", "The argument map cannot be removed")
        }

        if (operation.operation === "test") {
          if (!isDeepStrictEqual(result, operation.value)) {
            throw new PatchFailure("TEST_FAILED", "The value at the path does not match")
          }
          continue
        }

        if (!isRecord(operation.value)) {
          throw new PatchFailure("ROOT_VALUE_INVALID", "The argument map must be an object")
        }

        result = structuredClone(operation.value)
        continue
      }

      applyAtPath(result, tokens, operation)
    } catch (error) {
      if (error instanceof ProjectModelArgumentPatchError) {
        throw error
      }

      const failure =
        error instanceof PatchFailure
          ? error
          : new PatchFailure("VALUE_INVALID", "The value at the path cannot be patched", error)
      throw new ProjectModelArgumentPatchError(
        operationIndex,
        operation.path,
        failure.reason,
        failure.message,
        failure.cause,
      )
    }
  }

  return result
}

function parseJsonPointer(path: string): string[] {
  if (path === "") return []
  if (!path.startsWith("/")) {
    throw new PatchFailure("PATH_INVALID", "The path must be an RFC 6901 JSON Pointer")
  }

  return path
    .slice(1)
    .split("/")
    .map(segment => {
      if (/~(?:[^01]|$)/.test(segment)) {
        throw new PatchFailure("PATH_INVALID", "The path contains an invalid escape sequence")
      }

      return segment.replaceAll("~1", "/").replaceAll("~0", "~")
    })
}

function applyAtPath(
  current: unknown,
  tokens: readonly string[],
  operation: InstanceArgumentPatchOperation,
): void {
  const yamlValue = yamlValueSchema.safeParse(current)
  if (yamlValue.success) {
    let parsed: unknown
    try {
      parsed = parse(yamlValue.data.value) as unknown
    } catch (error) {
      throw new PatchFailure("YAML_INVALID", "The YAML value at the path cannot be parsed", error)
    }

    applyAtPath(parsed, tokens, operation)
    Object.defineProperty(current as Record<string, unknown>, "value", {
      value: stringify(parsed),
      configurable: true,
      enumerable: true,
      writable: true,
    })
    return
  }

  if (!isContainer(current)) {
    throw new PatchFailure("PATH_NOT_TRAVERSABLE", "The path traverses a scalar value")
  }

  const [token, ...remaining] = tokens
  if (token === undefined) return

  if (remaining.length > 0) {
    const child = getExistingValue(current, token)
    applyAtPath(child, remaining, operation)
    return
  }

  applyToContainer(current, token, operation)
}

function applyToContainer(
  container: JsonContainer,
  token: string,
  operation: InstanceArgumentPatchOperation,
): void {
  if (operation.operation === "test") {
    const existing = getExistingValue(container, token)
    if (!isDeepStrictEqual(existing, operation.value)) {
      throw new PatchFailure("TEST_FAILED", "The value at the path does not match")
    }
    return
  }

  if (Array.isArray(container)) {
    applyToArray(container, token, operation)
    return
  }

  const exists = Object.hasOwn(container, token)
  if (operation.operation === "remove") {
    if (!exists) throw pathNotFound()
    delete container[token]
    return
  }

  if (operation.operation === "replace" && !exists) throw pathNotFound()
  Object.defineProperty(container, token, {
    value: structuredClone(operation.value),
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

function applyToArray(
  array: unknown[],
  token: string,
  operation: Exclude<InstanceArgumentPatchOperation, { operation: "test" }>,
): void {
  if (operation.operation === "add" && token === "-") {
    array.push(structuredClone(operation.value))
    return
  }

  const index = parseArrayIndex(token)
  if (operation.operation === "add") {
    if (index > array.length) throw pathNotFound()
    array.splice(index, 0, structuredClone(operation.value))
    return
  }

  if (index >= array.length) throw pathNotFound()
  if (operation.operation === "remove") {
    array.splice(index, 1)
  } else {
    array[index] = structuredClone(operation.value)
  }
}

function getExistingValue(container: JsonContainer, token: string): unknown {
  if (Array.isArray(container)) {
    const index = parseArrayIndex(token)
    if (index >= container.length) throw pathNotFound()
    return container[index]
  }

  if (!Object.hasOwn(container, token)) throw pathNotFound()
  return container[token]
}

function parseArrayIndex(token: string): number {
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new PatchFailure("ARRAY_INDEX_INVALID", "The path contains an invalid array index")
  }

  const index = Number(token)
  if (!Number.isSafeInteger(index)) {
    throw new PatchFailure("ARRAY_INDEX_INVALID", "The path contains an invalid array index")
  }

  return index
}

function isContainer(value: unknown): value is JsonContainer {
  return Array.isArray(value) || isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pathNotFound(): PatchFailure {
  return new PatchFailure("PATH_NOT_FOUND", "The path does not exist")
}

class PatchFailure extends Error {
  constructor(
    readonly reason: string,
    message: string,
    options?: unknown,
  ) {
    super(message, { cause: options })
  }
}

/**
 * Deletes all references to an instance from other instances' inputs.
 *
 * @param inputs The inputs record to clean up.
 * @param instanceId The instance ID to remove references to.
 */
export function deleteInstanceReferences(
  inputs: Record<string, InstanceInput[]>,
  instanceId: string,
): void {
  for (const [inputKey, input] of Object.entries(inputs)) {
    inputs[inputKey] = input.filter(inputItem => inputItem.instanceId !== instanceId)

    if (inputs[inputKey].length === 0) {
      delete inputs[inputKey]
    }
  }
}

/**
 * Deletes all references to a hub from instance hub inputs.
 *
 * @param inputs The hub inputs record to clean up.
 * @param hubId The hub ID to remove references to.
 */
export function deleteHubReferences(inputs: Record<string, HubInput[]>, hubId: string): void {
  for (const [inputKey, input] of Object.entries(inputs)) {
    inputs[inputKey] = input.filter(inputItem => inputItem.hubId !== hubId)

    if (inputs[inputKey].length === 0) {
      delete inputs[inputKey]
    }
  }
}

/**
 * Updates all references to an instance with a new instance ID.
 *
 * @param inputs The inputs array to update.
 * @param oldInstanceId The old instance ID to replace.
 * @param newInstanceId The new instance ID to use.
 */
export function renameInstanceReferences(
  inputs: InstanceInput[],
  oldInstanceId: string,
  newInstanceId: InstanceId,
): void {
  for (const input of inputs) {
    if (input.instanceId === oldInstanceId) {
      input.instanceId = newInstanceId
    }
  }
}

/**
 * Removes all references to a deleted instance from instances and hubs.
 *
 * @param instances The instances to clean up.
 * @param hubs The hubs to clean up.
 * @param instanceId The instance ID to remove references to.
 */
export function cleanupInstanceReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  instanceId: string,
): void {
  // delete all inputs of instances that reference deleted instance
  for (const otherInstance of instances) {
    if (!otherInstance.inputs) {
      continue
    }

    deleteInstanceReferences(otherInstance.inputs, instanceId)

    if (Object.keys(otherInstance.inputs).length === 0) {
      delete otherInstance.inputs
    }
  }

  // delete all inputs of hubs that reference deleted instance
  for (const hub of hubs) {
    if (!hub.inputs) {
      continue
    }

    hub.inputs = hub.inputs.filter(input => input.instanceId !== instanceId)

    if (hub.inputs.length === 0) {
      delete hub.inputs
    }
  }
}

/**
 * Removes all references to a deleted hub from instances and hubs.
 *
 * @param instances The instances to clean up.
 * @param hubs The hubs to clean up.
 * @param hubId The hub ID to remove references to.
 */
export function cleanupHubReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  hubId: string,
): void {
  // delete all inputs of instances that reference deleted hub
  for (const instance of instances) {
    if (instance.hubInputs) {
      deleteHubReferences(instance.hubInputs, hubId)

      if (Object.keys(instance.hubInputs).length === 0) {
        delete instance.hubInputs
      }
    }

    if (instance.injectionInputs) {
      instance.injectionInputs = instance.injectionInputs.filter(input => input.hubId !== hubId)

      if (instance.injectionInputs.length === 0) {
        delete instance.injectionInputs
      }
    }
  }

  // delete all inputs of hubs that reference deleted hub
  for (const otherHub of hubs) {
    if (!otherHub.injectionInputs) {
      continue
    }

    otherHub.injectionInputs = otherHub.injectionInputs.filter(input => input.hubId !== hubId)

    if (otherHub.injectionInputs.length === 0) {
      delete otherHub.injectionInputs
    }
  }
}

/**
 * Updates all references to a renamed instance in instances and hubs.
 *
 * @param instances The instances to update.
 * @param hubs The hubs to update.
 * @param oldInstanceId The old instance ID to replace.
 * @param newInstanceId The new instance ID to use.
 */
export function updateInstanceReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  oldInstanceId: string,
  newInstanceId: InstanceId,
): void {
  // update all references to the instance from other instances
  for (const otherInstance of instances) {
    for (const inputs of Object.values(otherInstance.inputs ?? {})) {
      renameInstanceReferences(inputs, oldInstanceId, newInstanceId)
    }
  }

  // update all references to the instance from hubs
  for (const hub of hubs) {
    renameInstanceReferences(hub.inputs ?? [], oldInstanceId, newInstanceId)
  }
}

/**
 * Applies a patch to an instance model.
 *
 * @param instance The instance to patch.
 * @param patch The patch to apply.
 */
export function applyInstancePatch(instance: InstanceModel, patch: InstanceModelPatch): void {
  if (patch.args) {
    instance.args = patch.args
  }

  if (patch.position !== undefined) {
    if (patch.position) {
      instance.position = {
        x: patch.position.x ?? instance.position?.x ?? 0,
        y: patch.position.y ?? instance.position?.y ?? 0,
      }
    } else {
      delete instance.position
    }
  }

  if (patch.inputs) {
    if (Object.keys(patch.inputs).length > 0) {
      instance.inputs = patch.inputs
    } else {
      delete instance.inputs
    }
  }

  if (patch.hubInputs) {
    if (Object.keys(patch.hubInputs).length > 0) {
      instance.hubInputs = patch.hubInputs
    } else {
      delete instance.hubInputs
    }
  }

  if (patch.injectionInputs) {
    if (patch.injectionInputs.length > 0) {
      instance.injectionInputs = patch.injectionInputs
    } else {
      delete instance.injectionInputs
    }
  }
}

/**
 * Applies a patch to a hub model.
 *
 * @param hub The hub to patch.
 * @param patch The patch to apply.
 */
export function applyHubPatch(hub: HubModel, patch: HubModelPatch): void {
  if (patch.position !== undefined) {
    if (patch.position) {
      hub.position = {
        x: patch.position.x ?? hub.position?.x ?? 0,
        y: patch.position.y ?? hub.position?.y ?? 0,
      }
    } else {
      delete hub.position
    }
  }

  if (patch.inputs) {
    if (patch.inputs.length > 0) {
      hub.inputs = patch.inputs
    } else {
      delete hub.inputs
    }
  }

  if (patch.injectionInputs) {
    if (patch.injectionInputs.length > 0) {
      hub.injectionInputs = patch.injectionInputs
    } else {
      delete hub.injectionInputs
    }
  }
}
