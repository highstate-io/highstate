import {
  type ComponentModel,
  type HubInput,
  type HubModel,
  type InstanceInput,
  type InstanceModel,
  isUnitModel,
} from "@highstate/contract"
import { fromEntries, mapValues } from "remeda"
import { GraphResolver } from "./graph-resolver"

export type InputResolverNode =
  | {
      kind: "instance"
      instance: InstanceModel
      component: ComponentModel
    }
  | {
      kind: "hub"
      hub: HubModel
    }

export type ResolvedInstanceInput = {
  input: InstanceInput
  type: string
}

export type InputResolverOutput =
  | {
      kind: "instance"
      instance: InstanceModel
      component: ComponentModel
      resolvedInputs: Record<string, ResolvedInstanceInput[]>
      resolvedOutputs: Record<string, InstanceInput[]> | undefined
      resolvedInjectionInputs: ResolvedInstanceInput[]
      matchedInjectionInputs: ResolvedInstanceInput[]
    }
  | {
      kind: "hub"
      hub: HubModel
      resolvedInputs: ResolvedInstanceInput[]
    }

/**
 * Resolves the all recursive instance and hub inputs based on its direct inputs and injected inputs.
 */
export class InputResolver extends GraphResolver<InputResolverNode, InputResolverOutput> {
  getNodeDependencies(node: InputResolverNode): string[] {
    const dependencies: string[] = []

    if (node.kind === "hub") {
      for (const input of node.hub.inputs ?? []) {
        dependencies.push(`instance:${input.instanceId}`)
      }

      for (const input of node.hub.injectionInputs ?? []) {
        dependencies.push(`hub:${input.hubId}`)
      }

      return dependencies
    }

    for (const inputs of Object.values(node.instance.inputs ?? {})) {
      for (const input of inputs) {
        dependencies.push(`instance:${input.instanceId}`)
      }
    }

    for (const inputs of Object.values(node.instance.hubInputs ?? {})) {
      for (const input of inputs) {
        dependencies.push(`hub:${input.hubId}`)
      }
    }

    for (const input of node.instance.injectionInputs ?? []) {
      dependencies.push(`hub:${input.hubId}`)
    }

    return dependencies
  }

  processNode(node: InputResolverNode): InputResolverOutput {
    const getHubOutput = (input: HubInput) => {
      const output = this.outputs.get(`hub:${input.hubId}`)
      if (!output) {
        return { resolvedInputs: [] }
      }

      if (output.kind !== "hub") {
        throw new Error("Expected hub node")
      }

      return output
    }

    const getInstanceOutput = (input: InstanceInput) => {
      const output = this.outputs.get(`instance:${input.instanceId}`)
      if (!output) {
        return {
          component: null,
          resolvedInputs: [] as ResolvedInstanceInput[],
          resolvedOutputs: [] as InstanceInput[],
        }
      }

      if (output.kind !== "instance") {
        throw new Error("Expected instance node")
      }

      return {
        component: output.component,
        resolvedInputs: output.resolvedInputs[input.output] ?? [],
        resolvedOutputs: output.resolvedOutputs?.[input.output],
      }
    }

    // resolve inputs for hub
    if (node.kind === "hub") {
      const hubResult: Map<string, ResolvedInstanceInput> = new Map()

      const addHubResult = (input: ResolvedInstanceInput) => {
        hubResult.set(`${input.input.instanceId}:${input.input.output}`, input)
      }

      for (const input of node.hub.inputs ?? []) {
        const { component } = getInstanceOutput(input)
        const componentInput = component?.outputs[input.output]

        if (!componentInput) {
          this.logger.warn({ msg: "output not found in the component", input, component })
          continue
        }

        addHubResult({ input, type: componentInput.type })
      }

      for (const injectionInput of node.hub.injectionInputs ?? []) {
        const { resolvedInputs } = getHubOutput(injectionInput)

        for (const input of resolvedInputs) {
          addHubResult(input)
        }
      }

      return {
        kind: "hub",
        hub: node.hub,
        resolvedInputs: Array.from(hubResult.values()),
      }
    }

    // use evaluation results for virtual instances (composite children)
    // this is NOT an optimization - it's the ONLY way to resolve inputs for composite children
    // because they don't exist in the project model
    // the project model only contains top-level instances,
    // while composite children are produced by evaluation
    // without this, we cannot resolve connections to/from instances inside composites
    // this doesn't create a circular dependency because evaluation only needs resolution for
    // top-level instances (from project model), not for the virtual instances it produces
    if (node.instance.resolvedInputs) {
      return {
        kind: "instance",
        instance: node.instance,
        component: node.component,
        resolvedInputs: mapValues(node.instance.resolvedInputs, (inputs, inputName) => {
          const componentInput = node.component.inputs[inputName]
          if (!componentInput) {
            this.logger.warn({
              msg: "input not found in the component",
              inputName,
              component: node.component,
            })
            return []
          }

          return inputs.map(input => ({ input, type: componentInput.type }))
        }),
        resolvedOutputs: node.instance.resolvedOutputs ?? {},
        resolvedInjectionInputs: [],
        matchedInjectionInputs: [],
      }
    }

    // resolve inputs for instance
    const resolvedInputsMap: Map<string, Map<string, ResolvedInstanceInput>> = new Map()

    const addInstanceResult = (inputName: string, input: ResolvedInstanceInput) => {
      let inputs = resolvedInputsMap.get(inputName)
      if (!inputs) {
        inputs = new Map()
        resolvedInputsMap.set(inputName, inputs)
      }

      inputs.set(`${input.input.instanceId}:${input.input.output}`, input)
    }

    const addInstanceInput = (inputName: string, input: InstanceInput) => {
      const componentInput = node.component.inputs[inputName]
      if (!componentInput) {
        this.logger.warn({
          msg: "input not found in the component",
          input,
          component: node.component,
        })
        return
      }

      const { component, resolvedOutputs } = getInstanceOutput(input)

      if (!component) {
        this.logger.warn({ instanceId: node.instance.id, input }, "no output found for the input")
        return
      }

      if (isUnitModel(component)) {
        addInstanceResult(inputName, { input, type: componentInput.type })
        return
      }

      if (resolvedOutputs) {
        for (const output of resolvedOutputs) {
          addInstanceResult(inputName, { input: output, type: componentInput.type })
        }
      } else {
        // if the instance is not evaluated, we a forced to use the input as is
        addInstanceResult(inputName, { input, type: componentInput.type })
      }
    }

    for (const [inputName, inputs] of Object.entries(node.instance.inputs ?? {})) {
      for (const input of inputs) {
        addInstanceInput(inputName, input)
      }
    }

    const injectionInputs: Map<string, ResolvedInstanceInput> = new Map()
    const matchedInjectionInputs: Map<string, ResolvedInstanceInput> = new Map()

    for (const injectionInput of node.instance.injectionInputs ?? []) {
      const { resolvedInputs } = getHubOutput(injectionInput)
      for (const input of resolvedInputs) {
        injectionInputs.set(`${input.input.instanceId}:${input.input.output}`, input)
      }
    }

    for (const [inputName, componentInput] of Object.entries(node.component.inputs ?? {})) {
      const allInputs = new Map<string, ResolvedInstanceInput>(injectionInputs)
      const hubInputs = node.instance.hubInputs?.[inputName] ?? []

      for (const hubInput of hubInputs) {
        const { resolvedInputs } = getHubOutput(hubInput)
        for (const input of resolvedInputs) {
          allInputs.set(`${input.input.instanceId}:${input.input.output}`, input)
        }
      }

      for (const input of allInputs.values()) {
        if (input.type === componentInput.type) {
          addInstanceInput(inputName, input.input)

          const key = `${input.input.instanceId}:${input.input.output}`
          if (injectionInputs.has(key)) {
            matchedInjectionInputs.set(key, input)
          }
        }
      }
    }

    const resolvedInputs = fromEntries(
      Array.from(resolvedInputsMap.entries()).map(([inputName, inputs]) => [
        inputName,
        Array.from(inputs.values()),
      ]),
    )

    return {
      kind: "instance",
      instance: node.instance,
      component: node.component,
      resolvedInputs,
      resolvedOutputs: node.instance.resolvedOutputs,
      resolvedInjectionInputs: Array.from(injectionInputs.values()),
      matchedInjectionInputs: Array.from(matchedInjectionInputs.values()),
    }
  }
}

export function getResolvedHubInputs(
  outputMap: ReadonlyMap<string, InputResolverOutput>,
  hubId: string,
): ResolvedInstanceInput[] {
  const output = outputMap.get(`hub:${hubId}`)
  if (!output) {
    return []
  }

  if (output.kind !== "hub") {
    throw new Error("Expected hub node")
  }

  return output.resolvedInputs
}

export function getResolvedInstanceInputs(
  outputMap: ReadonlyMap<string, InputResolverOutput>,
  instanceId: string,
): Record<string, ResolvedInstanceInput[]> {
  const output = outputMap.get(`instance:${instanceId}`)
  if (!output) {
    return {}
  }

  if (output.kind !== "instance") {
    throw new Error("Expected instance node")
  }

  return output.resolvedInputs
}

export function getResolvedInjectionInstanceInputs(
  outputMap: ReadonlyMap<string, InputResolverOutput>,
  instanceId: string,
): ResolvedInstanceInput[] {
  const output = outputMap.get(`instance:${instanceId}`)
  if (!output) {
    return []
  }

  if (output.kind !== "instance") {
    throw new Error("Expected instance node")
  }

  return output.resolvedInjectionInputs
}

export function getMatchedInjectionInstanceInputs(
  outputMap: ReadonlyMap<string, InputResolverOutput>,
  instanceId: string,
): ResolvedInstanceInput[] {
  const output = outputMap.get(`instance:${instanceId}`)
  if (!output) {
    return []
  }

  if (output.kind !== "instance") {
    throw new Error("Expected instance node")
  }

  return output.matchedInjectionInputs
}

export function getResolvedInstanceOutputs(
  outputMap: ReadonlyMap<string, InputResolverOutput>,
  instanceId: string,
): Record<string, InstanceInput[]> | undefined {
  const output = outputMap.get(`instance:${instanceId}`)
  if (!output) {
    return undefined
  }

  if (output.kind !== "instance") {
    throw new Error("Expected instance node")
  }

  return output.resolvedOutputs
}
