import type { GraphEdge, GraphNode, VueFlowStore } from "@vue-flow/core"
import type { EventHookOn } from "@vueuse/core"
import type { RoutedEdgeData } from "#layers/core/app/features/canvas"
import type {
  EdgeRouterEdge,
  EdgeRouterInputMessage,
  EdgeRouterOutputMessage,
  EdgeRouterShape,
} from "#layers/core/app/workers/edge-router"
import { createId } from "@paralleldrive/cuid2"
import EdgeRouterWorker from "#layers/core/app/workers/edge-router?sharedworker"
import { createEdgeRouterMessageQueue } from "./edge-router-message-queue"

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
  const messageQueue = createEdgeRouterMessageQueue(postMessage)
  let geometryDirty = false
  let disposed = false
  let initializationFrame: number | null = null
  let flushScheduled = false
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

  const flushQueuedMessages = () => {
    if (!ready.value) {
      return
    }

    messageQueue.flush()
  }

  const scheduleFlushQueuedMessages = () => {
    if (flushScheduled) {
      return
    }

    flushScheduled = true

    queueMicrotask(() => {
      flushScheduled = false
      flushQueuedMessages()
    })
  }

  const queueRouterMessage = (message: EdgeRouterInputMessage) => {
    messageQueue.enqueue(message)

    if (message.type !== "process-transaction") {
      geometryDirty = true
    }

    scheduleFlushQueuedMessages()
  }

  const getShapeFromGraphNode = (node: GraphNode): EdgeRouterShape | null => {
    const {
      computedPosition: { x, y },
      dimensions: { width, height },
    } = node

    if (!width || !height) {
      return null
    }

    return { id: node.id, x, y, width, height }
  }

  const getEdgeFromGraphEdge = (edge: GraphEdge): EdgeRouterEdge => {
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

  const updateGraphNodeShape = (node: GraphNode) => {
    const shape = getShapeFromGraphNode(node)
    if (shape) {
      queueRouterMessage({ type: "update-shape", routerId, shape })
    }
  }

  const removeGraphNodeShape = (nodeId: string) => {
    queueRouterMessage({ type: "remove-shape", routerId, shapeId: nodeId })
  }

  const createGraphEdge = (edge: GraphEdge) => {
    queueRouterMessage({ type: "add-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const updateGraphEdge = (edge: GraphEdge) => {
    queueRouterMessage({ type: "update-edge", routerId, edge: getEdgeFromGraphEdge(edge) })
  }

  const removeGraphEdge = (edgeId: string) => {
    queueRouterMessage({ type: "remove-edge", routerId, edgeId })
  }

  const processTransaction = useDebounceFn(() => {
    if (!geometryDirty) {
      return
    }

    queueRouterMessage({ type: "process-transaction", routerId })
    geometryDirty = false
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
        flushQueuedMessages()
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
    messageQueue.clear()
  })

  onScopeDispose(() => {
    disposed = true
    globalLogger.debug({ routerId }, "disposing edge router")

    if (initializationFrame !== null) {
      cancelAnimationFrame(initializationFrame)
    }

    if (edgePathFlushHandle !== null) {
      cancelAnimationFrame(edgePathFlushHandle)
      edgePathFlushHandle = null
    }

    pendingEdgePathUpdates.clear()

    if (ready.value) {
      postMessage({ type: "dispose-router", routerId })
    }
  })

  // node initialization precedes rendered edge coordinates and lane-offset frames
  // snapshot after those updates, rather than routing every edge twice on opening
  void nextTick(() => {
    if (disposed) {
      return
    }

    initializationFrame = requestAnimationFrame(() => {
      initializationFrame = null

      const shapes = vueFlowStore.nodes.value
        .map(node => getShapeFromGraphNode(node))
        .filter(Boolean) as EdgeRouterShape[]

      const edges = vueFlowStore.edges.value.map(edge => getEdgeFromGraphEdge(edge))

      // the complete snapshot supersedes mutations queued before it was captured
      messageQueue.clear()
      geometryDirty = false
      globalLogger.debug({ routerId, shapes, edges }, "creating edge router")
      postMessage({ type: "create-router", routerId, shapes, edges })
    })
  })
}
