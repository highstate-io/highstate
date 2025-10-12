import type { ComponentModel, HubModel, InstanceModel } from "@highstate/contract"
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
  connection: Connection,
) => {
  const { outputInstance, inputInstance, inputHub, outputHub, outputKey, inputKey } =
    getConnectionNodes(vueFlowStore, connection)

  if (inputHub || outputHub) {
    // all connections from/to a hub are valid
    return true
  }

  const outputComponent: ComponentModel | undefined = outputInstance
    ? libraryStore.components[outputInstance.type]
    : undefined

  const inputComponent: ComponentModel | undefined = inputInstance
    ? libraryStore.components[inputInstance.type]
    : undefined

  if (!outputComponent || !inputComponent) {
    return false
  }

  const output = outputComponent.outputs[outputKey]
  const input = inputComponent.inputs[inputKey]

  if (!input || !output) {
    return false
  }

  if (input.type !== output.type) {
    // type mismatch
    return false
  }

  // TODO: check for multipe connections
  // TODO: check for duplicate connections
  return true
}
