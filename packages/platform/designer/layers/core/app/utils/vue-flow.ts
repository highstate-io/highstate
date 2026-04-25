import {
  isAssignableTo,
  type ComponentModel,
  type HubModel,
  type InstanceInput,
  type InstanceModel,
} from "@highstate/contract"
import { type InputResolverOutput, resolveEffectiveOutputType } from "@highstate/backend/shared"
import type { Connection, VueFlowStore } from "@vue-flow/core"

import LayoutWorker from "#layers/core/app/workers/graph-layout?sharedworker"
import type {
  InputNode,
  InputEdge,
  LayoutInput,
  LayoutOutput,
  OutputNode,
} from "#layers/core/app/workers/graph-layout"
import { createId } from "@paralleldrive/cuid2"

const { onMessage, postMessage } = useHSWebWorker<LayoutInput, LayoutOutput>(LayoutWorker, {
  name: "graph-layout",
})

/**
 * Layouts all nodes in the VueFlow store using a shared worker.
 *
 * After the layout is computed, it updates the positions of the nodes in the store
 * and makes them visible if they were hidden.
 *
 * @param vueFlowStore The VueFlow store containing the nodes and edges to be laid out.
 */
export async function layoutNodes(vueFlowStore: VueFlowStore) {
  const nodes: InputNode[] = []
  const edges: InputEdge[] = []

  for (const node of vueFlowStore.getNodes.value) {
    nodes.push({ id: node.id, width: node.dimensions.width, height: node.dimensions.height })

    if (node.id !== "outputs") {
      edges.push({ source: node.id, target: "outputs" })
    }
  }

  for (const edge of vueFlowStore.edges.value) {
    edges.push({ source: edge.source, target: edge.target })
  }

  const requestId = createId()

  postMessage({
    requestId,
    nodes,
    edges,
  })

  globalLogger.info({ requestId, nodes, edges }, "layoutNodes: sending layout request")

  const outputNodes = await new Promise<OutputNode[]>(resolve => {
    const { off } = onMessage(event => {
      if (event.requestId === requestId) {
        resolve(event.nodes)
        off()
      }
    })
  })

  globalLogger.info({ requestId, outputNodes }, "layoutNodes: received layout response")

  for (const node of outputNodes) {
    vueFlowStore.updateNode(node.id, {
      position: { x: node.x, y: node.y },
    })
  }
}

export function waitForLayoutCompletion(vueFlowStore: VueFlowStore): Promise<void> {
  return new Promise(resolve => {
    const { off } = vueFlowStore.onNodesInitialized(() => {
      resolve()
      off()
    })
  })
}

export function getConnectionNodes(vueFlowStore: VueFlowStore, connection: Connection) {
  const outputNode = vueFlowStore.findNode(connection.source)
  const inputNode = vueFlowStore.findNode(connection.target)

  if (!outputNode || !inputNode) {
    globalLogger.error({ connection, outputNode, inputNode }, "output or input node not found")

    throw new Error("Output or input node not found")
  }

  const outputInstance: InstanceModel | undefined =
    "instance" in outputNode.data ? outputNode.data.instance : undefined

  const inputInstance: InstanceModel | undefined =
    "instance" in inputNode.data ? inputNode.data.instance : undefined

  const outputHub: HubModel | undefined =
    outputNode.type === "hub" ? outputNode.data.hub : undefined

  const inputHub: HubModel | undefined = inputNode.type === "hub" ? inputNode.data.hub : undefined

  const outputKey = connection.sourceHandle!
  const inputKey = connection.targetHandle!

  return {
    outputNode,
    inputNode,
    outputInstance,
    inputInstance,
    outputHub,
    inputHub,
    outputKey,
    inputKey,
    inputNodeType: inputNode.type,
  }
}

export const validateConnection = (
  vueFlowStore: VueFlowStore,
  libraryStore: LibraryStore,
  inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>,
  connection: Connection,
) => {
  const { outputInstance, inputInstance, inputHub, outputHub, outputKey, inputKey } =
    getConnectionNodes(vueFlowStore, connection)

  const logRejectedConnection = (reason: string, details?: Record<string, unknown>) => {
    globalLogger.warn(
      {
        reason,
        connection,
        outputInstanceId: outputInstance?.id,
        outputInstanceType: outputInstance?.type,
        inputInstanceId: inputInstance?.id,
        inputInstanceType: inputInstance?.type,
        outputHubId: outputHub?.id,
        inputHubId: inputHub?.id,
        outputKey,
        inputKey,
        ...details,
      },
      "validateConnection: rejected",
    )
  }

  const inputComponent: ComponentModel | undefined = inputInstance
    ? libraryStore.components[inputInstance.type]
    : undefined

  if (outputHub && inputComponent && isForwardedSourceInput(inputComponent, inputKey)) {
    // fromInput forwarding requires direct single edge wiring for deterministic type forwarding
    logRejectedConnection("hub_to_forwarded_source_input")
    return false
  }

  if (inputHub || outputHub) {
    // hub wiring remains permissive except forwarded-source inputs
    return true
  }

  const outputComponent: ComponentModel | undefined = outputInstance
    ? libraryStore.components[outputInstance.type]
    : undefined

  if (!outputComponent || !inputComponent) {
    logRejectedConnection("missing_component", {
      hasOutputComponent: !!outputComponent,
      hasInputComponent: !!inputComponent,
    })
    return false
  }

  const output = outputComponent.outputs[outputKey]
  const input = inputComponent.inputs[inputKey]

  if (!input || !output) {
    logRejectedConnection("missing_handle", {
      hasInputHandle: !!input,
      hasOutputHandle: !!output,
    })
    return false
  }

  const outputEntityType = resolveEffectiveOutputTypeForConnection(
    vueFlowStore,
    libraryStore,
    inputResolverOutputs,
    {
      instanceId: outputInstance!.id,
      output: outputKey,
    },
    output.type,
  )

  const outputEntity = libraryStore.entities[outputEntityType]
  if (!outputEntity) {
    logRejectedConnection("missing_output_entity", {
      outputEntityType,
    })
    return false
  }

  if (!isAssignableTo(outputEntity, input.type)) {
    // type mismatch
    logRejectedConnection("type_mismatch", {
      outputEntityType,
      inputEntityType: input.type,
    })
    return false
  }

  if (hasDuplicateConnection(vueFlowStore, connection)) {
    logRejectedConnection("duplicate_connection")
    return false
  }

  if (!input.multiple && hasAnotherConnectionForInput(vueFlowStore, connection)) {
    logRejectedConnection("single_input_already_connected", {
      inputMultiple: input.multiple,
    })
    return false
  }

  return true
}

function isForwardedSourceInput(component: ComponentModel, inputName: string): boolean {
  return Object.values(component.outputs).some(output => output.fromInput === inputName)
}

function hasDuplicateConnection(vueFlowStore: VueFlowStore, connection: Connection): boolean {
  return vueFlowStore.edges.value.some(edge => {
    return (
      edge.source === connection.source &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.target === connection.target &&
      edge.targetHandle === connection.targetHandle
    )
  })
}

function hasAnotherConnectionForInput(vueFlowStore: VueFlowStore, connection: Connection): boolean {
  return vueFlowStore.edges.value.some(edge => {
    return edge.target === connection.target && edge.targetHandle === connection.targetHandle
  })
}

function resolveEffectiveOutputTypeForConnection(
  vueFlowStore: VueFlowStore,
  libraryStore: LibraryStore,
  inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>,
  input: InstanceInput,
  fallbackType: string,
): string {
  return resolveEffectiveOutputType({
    input,
    fallbackType,
    getInstanceContext: instanceId => {
      const resolvedOutput = inputResolverOutputs.get(`instance:${instanceId}`)
      if (resolvedOutput && resolvedOutput.kind === "instance") {
        return {
          instance: resolvedOutput.instance,
          component: resolvedOutput.component,
          entities: resolvedOutput.entities,
        }
      }

      const outputNode = vueFlowStore.findNode(instanceId)
      const producerInstance: InstanceModel | undefined =
        outputNode && "instance" in outputNode.data ? outputNode.data.instance : undefined

      if (!producerInstance) {
        return undefined
      }

      const producerComponent = libraryStore.components[producerInstance.type]
      if (!producerComponent) {
        return undefined
      }

      return {
        instance: producerInstance,
        component: producerComponent,
        entities: libraryStore.entities,
      }
    },
  })
}
