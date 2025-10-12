import type { VueFlowStore, GraphNode, GraphEdge } from "@vue-flow/core"
import EdgeRouterWorker from "#layers/core/app/workers/edge-router?sharedworker"
import type {
  EdgeRouterEdge,
  EdgeRouterInputMessage,
  EdgeRouterOutputMessage,
  EdgeRouterShape,
} from "#layers/core/app/workers/edge-router"
import { createId } from "@paralleldrive/cuid2"
import type { EventHookOn } from "@vueuse/core"

const {
  //
  onMessage,
  postMessage,
  onError,
} = useHSWebWorker<EdgeRouterInputMessage, EdgeRouterOutputMessage>(EdgeRouterWorker, {
  name: "edge-router",
})

export function setupEdgeRouter(
  vueFlowStore: VueFlowStore,
  onNodesMoved: EventHookOn<[GraphNode[], GraphEdge[]]>,
): void {
  const routerId = createId()
  const ready = ref(false)

  const safePostMessage = async (message: EdgeRouterInputMessage) => {
    await until(ready).toBe(true)
    postMessage(message)
  }

  const getShapeFromGraphNode = (node: GraphNode<any, any, string>): EdgeRouterShape | null => {
    const {
      computedPosition: { x, y },
      dimensions: { width, height },
    } = node

    if (!width || !height) {
      return null
    }

    return { id: node.id, x, y, width, height }
  }

  const getEdgeFromGraphEdge = (edge: GraphEdge<any, any, string>): EdgeRouterEdge => {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceX: edge.sourceX,
      sourceY: edge.sourceY,
      targetX: edge.targetX,
      targetY: edge.targetY,
    }
  }

  const updateGraphNodeShape = (node: GraphNode<any, any, string>) => {
    const shape = getShapeFromGraphNode(node)

    if (shape) {
      safePostMessage({ type: "update-shape", routerId, shape })
    }
  }

  const removeGraphNodeShape = (nodeId: string) => {
    safePostMessage({ type: "remove-shape", routerId, shapeId: nodeId })
  }

  const createGraphEdge = (edge: GraphEdge<any, any, string>) => {
    safePostMessage({ type: "add-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const updateGraphEdge = (edge: GraphEdge<any, any, string>) => {
    safePostMessage({ type: "update-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const removeGraphEdge = (edgeId: string) => {
    safePostMessage({ type: "remove-edge", routerId, edgeId })
  }

  const processTransaction = useDebounceFn(() => {
    safePostMessage({ type: "process-transaction", routerId })
  }, 100)

  onNodesMoved((nodes, edges) => {
    for (const item of nodes) {
      updateGraphNodeShape(item)
    }

    for (const edge of edges) {
      updateGraphEdge(edge)
    }

    processTransaction()
  })

  vueFlowStore.onNodesChange(changes => {
    let needReroute = false
    const nodesWithUpdatedPositions = new Set<string>()

    for (const change of changes) {
      if (change.type === "position" || change.type === "dimensions") {
        const item = vueFlowStore.findNode(change.id)
        updateGraphNodeShape(item!)

        const edges = vueFlowStore.getConnectedEdges(change.id)
        for (const edge of edges) {
          updateGraphEdge(edge)
        }

        needReroute = true
        nodesWithUpdatedPositions.add(change.id)
      } else if (change.type === "remove") {
        removeGraphNodeShape(change.id)
        needReroute = true
      }
    }

    if (!needReroute) {
      return
    }

    processTransaction()

    nextTick(() => {
      for (const nodeId of nodesWithUpdatedPositions) {
        const node = vueFlowStore.findNode(nodeId)
        updateGraphNodeShape(node!)

        const edges = vueFlowStore.getConnectedEdges(nodeId)
        for (const edge of edges) {
          updateGraphEdge(edge)
        }
      }

      processTransaction()
    })
  })

  vueFlowStore.onEdgesChange(changes => {
    let needReroute = false

    for (const change of changes) {
      if (change.type === "add") {
        nextTick(() => {
          const edge = vueFlowStore.findEdge(change.item.id)

          createGraphEdge(edge!)
          processTransaction()
        })
      } else if (change.type === "remove") {
        removeGraphEdge(change.id)
        needReroute = true
      }
    }

    if (needReroute) {
      processTransaction()
    }
  })

  onMessage(message => {
    if (message.routerId !== routerId) {
      return
    }

    switch (message.type) {
      case "router-ready": {
        ready.value = true
        break
      }
      case "edge-path-updated": {
        vueFlowStore.updateEdgeData(message.edgeId, { points: message.points })
        break
      }
    }
  })

  onError(() => {
    ready.value = false
  })

  onScopeDispose(() => {
    globalLogger.debug({ routerId }, "disposing edge router")

    if (ready.value) {
      postMessage({ type: "dispose-router", routerId })
    }
  })

  const shapes = vueFlowStore.nodes.value
    .map(node => getShapeFromGraphNode(node))
    .filter(Boolean) as EdgeRouterShape[]

  const edges = vueFlowStore.edges.value.map(edge => getEdgeFromGraphEdge(edge))

  globalLogger.debug({ routerId, shapes, edges }, "creating edge router")

  postMessage({ type: "create-router", routerId, shapes, edges })
}
