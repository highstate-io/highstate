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
  const queuedMessages = new Map<string, EdgeRouterInputMessage>()
  let flushScheduled = false
  let flushing = false
  const pendingEdgePathUpdates = new Map<string, number[][]>()
  let edgePathFlushHandle: number | null = null

  const flushEdgePathUpdates = () => {
    edgePathFlushHandle = null

    if (pendingEdgePathUpdates.size === 0) {
      return
    }

    const updates = Array.from(pendingEdgePathUpdates.entries())
    pendingEdgePathUpdates.clear()

    for (const [edgeId, points] of updates) {
      vueFlowStore.updateEdgeData(edgeId, { points })
    }
  }

  const scheduleFlushEdgePathUpdates = () => {
    if (edgePathFlushHandle !== null) {
      return
    }

    edgePathFlushHandle = requestAnimationFrame(() => {
      flushEdgePathUpdates()
    })
  }

  const getMessageKey = (message: EdgeRouterInputMessage): string => {
    switch (message.type) {
      case "add-shape":
      case "update-shape":
        return `shape:${message.shape.id}`
      case "remove-shape":
        return `shape:${message.shapeId}`
      case "add-edge":
      case "update-edge":
        return `edge:${message.edge.id}`
      case "remove-edge":
        return `edge:${message.edgeId}`
      case "process-transaction":
        return "process-transaction"
      case "create-router":
        return `create-router:${message.routerId}`
      case "dispose-router":
        return `dispose-router:${message.routerId}`
    }
  }

  const flushQueuedMessages = async () => {
    if (flushing || !ready.value) {
      return
    }

    flushing = true

    while (queuedMessages.size > 0) {
      const messages = Array.from(queuedMessages.values())
      queuedMessages.clear()

      for (const message of messages) {
        postMessage(message)
      }

      await Promise.resolve()
    }

    flushing = false
  }

  const scheduleFlushQueuedMessages = () => {
    if (flushScheduled) {
      return
    }

    flushScheduled = true

    queueMicrotask(() => {
      flushScheduled = false
      void flushQueuedMessages()
    })
  }

  const queueRouterMessage = (message: EdgeRouterInputMessage) => {
    queuedMessages.set(getMessageKey(message), message)
    scheduleFlushQueuedMessages()
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
      queueRouterMessage({ type: "update-shape", routerId, shape })
    }
  }

  const removeGraphNodeShape = (nodeId: string) => {
    queueRouterMessage({ type: "remove-shape", routerId, shapeId: nodeId })
  }

  const createGraphEdge = (edge: GraphEdge<any, any, string>) => {
    queueRouterMessage({ type: "add-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const updateGraphEdge = (edge: GraphEdge<any, any, string>) => {
    queueRouterMessage({ type: "update-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const removeGraphEdge = (edgeId: string) => {
    queueRouterMessage({ type: "remove-edge", routerId, edgeId })
  }

  const processTransaction = useDebounceFn(() => {
    queueRouterMessage({ type: "process-transaction", routerId })
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
        void flushQueuedMessages()
        break
      }
      case "edge-paths-updated": {
        for (const update of message.updates) {
          pendingEdgePathUpdates.set(update.edgeId, update.points)
        }

        scheduleFlushEdgePathUpdates()

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
    queuedMessages.clear()
  })

  onScopeDispose(() => {
    globalLogger.debug({ routerId }, "disposing edge router")

    if (edgePathFlushHandle !== null) {
      cancelAnimationFrame(edgePathFlushHandle)
      edgePathFlushHandle = null
    }

    pendingEdgePathUpdates.clear()

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
