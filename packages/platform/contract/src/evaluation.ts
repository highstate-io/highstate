import type { Component } from "./component"
import type { InstanceInput, InstanceModel, RuntimeInput } from "./instance"
import { mapValues } from "remeda"
import { boundaryInput } from "./shared"

export type RuntimeInstance = {
  instance: InstanceModel
  component: Component
}

function isStableInstanceInput(value: unknown): value is InstanceInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "instanceId" in value &&
    "output" in value &&
    typeof (value as { instanceId: unknown }).instanceId === "string" &&
    typeof (value as { output: unknown }).output === "string"
  )
}

function formatInstancePath(instance: InstanceModel): string {
  let result = instance.id
  while (instance.parentId) {
    const parent = runtimeInstances.get(instance.parentId)?.instance
    if (!parent) {
      break
    }

    result = `${parent.id} -> ${result}`
    instance = parent
  }

  return result
}

export class InstanceNameConflictError extends Error {
  constructor(
    readonly instanceId: string,
    readonly firstPath: string,
    readonly secondPath: string,
  ) {
    super(
      `Multiple instances produced with the same instance ID "${instanceId}":\n` +
        `1. ${firstPath}\n` +
        `2. ${secondPath}`,
    )

    this.name = "InstanceNameConflictError"
  }
}

let currentInstance: InstanceModel | null = null

const runtimeInstances: Map<string, RuntimeInstance> = new Map()

/**
 * Resets the evaluation state, clearing all collected composite instances and runtime instances.
 */
export function resetEvaluation(): void {
  runtimeInstances.clear()
  currentInstance = null
}

/**
 * Returns all runtime instances collected during the evaluation.
 *
 * Note that these instances are not serializable.
 */
export function getRuntimeInstances(): RuntimeInstance[] {
  return Array.from(runtimeInstances.values())
}

export function registerInstance<T>(component: Component, instance: InstanceModel, fn: () => T): T {
  const conflicting = runtimeInstances.get(instance.id)
  if (conflicting) {
    throw new InstanceNameConflictError(
      instance.id,
      formatInstancePath(conflicting.instance),
      formatInstancePath(instance),
    )
  }

  runtimeInstances.set(instance.id, { instance, component })

  let previousParentInstance: InstanceModel | null = null

  if (currentInstance) {
    instance.parentId = currentInstance.id
  }

  if (component.model.kind === "composite") {
    previousParentInstance = currentInstance
    currentInstance = instance
  }

  try {
    const rawOutputs = fn() as Record<string, RuntimeInput | RuntimeInput[] | undefined>
    const outputs = mapValues(rawOutputs ?? {}, outputGroup => {
      return [outputGroup].flat(2).filter(Boolean) as RuntimeInput[]
    })

    const toStableInputs = (
      outputGroup: RuntimeInput[],
      useBoundaryFallback: boolean,
    ): InstanceInput[] => {
      return outputGroup
        .map(output => (useBoundaryFallback ? output[boundaryInput] : output))
        .filter(isStableInstanceInput)
        .map(output => {
          return output.path
            ? {
                instanceId: output.instanceId,
                output: output.output,
                path: output.path,
              }
            : {
                instanceId: output.instanceId,
                output: output.output,
              }
        })
    }

    instance.resolvedOutputs = mapValues(outputs ?? {}, outputGroup =>
      toStableInputs(outputGroup, false),
    )
    instance.outputs = mapValues(outputs ?? {}, outputGroup => toStableInputs(outputGroup, true))

    // mark all outputs with the boundary input of the instance
    // keep object identity to preserve proxy-based deep accessors
    return mapValues(rawOutputs, (rawOutputGroup, outputKey) => {
      const outputRefs = (outputs[outputKey] ?? []).map(output => {
        if (output.provided) {
          output[boundaryInput] = { instanceId: instance.id, output: outputKey }
        }

        return output
      })

      if (component.model.outputs[outputKey]?.multiple) {
        const multipleOutput = (
          Array.isArray(rawOutputGroup) ? rawOutputGroup : outputRefs
        ) as RuntimeInput[] & Partial<{ [boundaryInput]: InstanceInput }>

        multipleOutput[boundaryInput] ??= { instanceId: instance.id, output: outputKey }

        return multipleOutput
      }

      return rawOutputGroup ?? outputRefs[0]
    }) as T
  } finally {
    if (previousParentInstance) {
      currentInstance = previousParentInstance
    }
  }
}
