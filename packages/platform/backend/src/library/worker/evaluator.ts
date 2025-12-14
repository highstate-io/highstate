import type { Logger } from "pino"
import type { ResolvedInstanceInput } from "../../shared"
import type { ProjectEvaluationResult } from "../abstractions"
import {
  type Component,
  getRuntimeInstances,
  type InstanceModel,
  InstanceNameConflictError,
  parseArgumentValue,
} from "@highstate/contract"
import { mapValues } from "remeda"
import { errorToString } from "../../common"

export function evaluateProject(
  logger: Logger,
  components: Readonly<Record<string, Component>>,
  allInstances: InstanceModel[],
  resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>,
): ProjectEvaluationResult {
  const allInstancesMap = new Map(allInstances.map(instance => [instance.id, instance]))

  const instanceErrors: Record<string, unknown> = {}
  const topLevelErrors: Record<string, string> = {}

  const instanceOutputs = new Map<string, Record<string, unknown>>()

  for (const instance of allInstances) {
    try {
      evaluateInstance(instance.id)
    } catch (error) {
      if (error instanceof InstanceNameConflictError) {
        // fail the whole evaluation if there's a name conflict
        return {
          success: false,
          error: error.message,
        }
      }
    }
  }

  return {
    success: true,

    virtualInstances: getRuntimeInstances()
      .map(instance => instance.instance)
      // only include top-level composite instances and their children
      .filter(instance => instance.kind === "composite" || !allInstancesMap.has(instance.id)),

    topLevelErrors,
  }

  function evaluateInstance(instanceId: InstanceModel["id"]): Record<string, unknown> {
    let outputs = instanceOutputs.get(instanceId)
    if (outputs) {
      return outputs
    }

    // do not evaluate instance if it has an error, just rethrow it
    const error = instanceErrors[instanceId]
    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw error
    }

    const instance = allInstancesMap.get(instanceId)
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`)
    }

    try {
      outputs = _evaluateInstance(instance)

      instanceOutputs.set(instanceId, outputs)
      return outputs
    } catch (error) {
      if (instance.kind === "composite" || !allInstancesMap.has(instance.id)) {
        topLevelErrors[instance.id] = errorToString(error)
      }

      instanceErrors[instanceId] = error
      throw error
    }
  }

  function _evaluateInstance(instance: InstanceModel): Record<string, unknown> {
    const inputs: Record<string, unknown> = {}

    logger.debug(`evaluating instance "%s"`, instance.id)

    for (const [inputName, input] of Object.entries(resolvedInputs[instance.id] ?? {})) {
      inputs[inputName] = input.map(input => {
        const evaluated = evaluateInstance(input.input.instanceId)

        return evaluated[input.input.output]
      })
    }

    const component = components[instance.type]
    if (!component) {
      throw new Error(`Component not found: ${instance.type}, required by instance: ${instance.id}`)
    }

    const parsedArgs = mapValues(instance.args ?? {}, rawValue => parseArgumentValue(rawValue))

    return component({
      name: instance.name,
      args: parsedArgs as Record<string, never>,
      inputs: inputs as Record<string, never>,
    })
  }
}
