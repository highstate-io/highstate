import type { VueFlowStore, GraphNode, GraphEdge } from "@vue-flow/core"
import EdgeRouterWorker from "#layers/core/app/workers/edge-router?sharedworker"
import type {
  EdgeRouterEdge,
  EdgeRouterInputMessage,
  EdgeRouterOutputMessage,
  EdgeRouterShape,
} from "#layers/core/app/workers/edge-router"
import type { RoutedEdgeData } from "#layers/core/app/features/canvas"
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
  edgeEndpointOffsets?: {
    onOffsetsUpdated: EventHookOn<[string[]]>
  },
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
    const data = (edge.data ?? {}) as RoutedEdgeData

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceX: edge.sourceX,
      sourceY: data.routedSourceY ?? edge.sourceY,
      targetX: edge.targetX,
      targetY: data.routedTargetY ?? edge.targetY,
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
    for (const change of changes) {
      if (change.type === "position" || change.type === "dimensions") {
        const item = vueFlowStore.findNode(change.id)
        updateGraphNodeShape(item!)

        const edges = vueFlowStore.getConnectedEdges(change.id)
        for (const edge of edges) {
          updateGraphEdge(edge)
        }
      } else if (change.type === "remove") {
        removeGraphNodeShape(change.id)
      }
    }

    processTransaction()
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

  edgeEndpointOffsets?.onOffsetsUpdated(edgeIds => {
    for (const edgeId of edgeIds) {
      const edge = vueFlowStore.findEdge(edgeId)
      if (!edge) {
        continue
      }

      updateGraphEdge(edge)
    }

    processTransaction()
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
