import type { Component } from "./component"
import type { InstanceInput, InstanceModel } from "./instance"
import { mapValues } from "remeda"

export type RuntimeInstance = {
  instance: InstanceModel
  component: Component
}

export const boundaryInput = Symbol("boundaryInput")
export const boundaryInputs = Symbol("boundaryInputs")

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
    const outputs = fn() as Record<string, InstanceInput[]>

    instance.resolvedOutputs = outputs
    instance.outputs = mapValues(outputs ?? {}, outputs =>
      outputs.map(output => output[boundaryInput] ?? output),
    )

    // mark all outputs with the boundary input of the instance
    return mapValues(outputs, (outputs, outputKey) =>
      outputs.map(output => ({
        ...output,
        [boundaryInput]: { instanceId: instance.id, output: outputKey },
      })),
    ) as T
  } finally {
    if (previousParentInstance) {
      currentInstance = previousParentInstance
    }
  }
}
