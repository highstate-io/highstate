import type { HubModel, InstanceModel } from "@highstate/contract"
import { getConnectedEdges, type GraphNode, type VueFlowStore } from "@vue-flow/core"
import type { CursorMode } from "./shared"
import type { HubNodeData, InstanceNodeData } from "./node-factory"
import type { CanvasSelection } from "./selection"

export function useNodeMovement(
  vueFlowStore: VueFlowStore,
  cursorMode: Ref<CursorMode>,
  selection: CanvasSelection,
) {
  const dragStartPosition = ref<{ x: number; y: number }>()
  const dragStartEdgePaths = shallowRef<Record<string, number[][]>>()

  const { on: onInstanceMoved, trigger: triggerInstanceMoved } = createEventHook<InstanceModel>()
  const { on: onHubMoved, trigger: triggerHubMoved } = createEventHook<HubModel>()

  const getStrongNodeEdges = (nodes: GraphNode[]) => {
    const nodeIds = new Set(nodes.map(node => node.id))

    // only include the edges that are only connected to the dragged nodes
    const allEdges = getConnectedEdges(nodes, vueFlowStore.edges.value)

    return allEdges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  }

  watch(cursorMode, mode => {
    // forbid dragging nodes in non-default modes
    vueFlowStore.nodesDraggable.value = mode === "default"
  })

  vueFlowStore.onNodeDragStart(({ nodes }) => {
    // prevent other interactions while dragging nodes
    cursorMode.value = "movement"

    // we use the first node's position as the drag start position
    // and assume that the order of nodes is not changed across drag events
    dragStartPosition.value = { x: nodes[0].position.x, y: nodes[0].position.y }

    dragStartEdgePaths.value = {}
    const edges = getStrongNodeEdges(nodes)

    for (const edge of edges) {
      dragStartEdgePaths.value[edge.id] = edge.data.points ?? []
    }
  })

  vueFlowStore.onNodeDrag(({ nodes }) => {
    // calculate the offset of the drag start position to recalculate the edge paths
    const offsetX = nodes[0].position.x - dragStartPosition.value!.x
    const offsetY = nodes[0].position.y - dragStartPosition.value!.y

    const edges = getStrongNodeEdges(nodes)

    // recalculate the edge paths based on the drag start position
    for (const edge of edges) {
      const startPath = dragStartEdgePaths.value![edge.id] ?? [0, 0]
      const newPath = startPath.map(point => [point[0] + offsetX, point[1] + offsetY])

      vueFlowStore.updateEdgeData(edge.id, { points: newPath })
    }
  })

  const handleInstanceDrag = (node: GraphNode<InstanceNodeData>) => {
    if (node.data.instance.parentId) {
      // ignore child nodes
      return
    }

    if (
      node.data.instance.position?.x === node.position.x &&
      node.data.instance.position?.y === node.position.y
    ) {
      return
    }

    node.data.instance.position = node.position
    triggerInstanceMoved(node.data.instance)
  }

  const handleHubDrag = (node: GraphNode<HubNodeData>) => {
    if (
      node.data.hub.position?.x === node.position.x &&
      node.data.hub.position?.y === node.position.y
    ) {
      return
    }

    node.data.hub.position = node.position
    triggerHubMoved(node.data.hub)
  }

  vueFlowStore.onNodeDragStop(({ nodes }) => {
    // reset the drag start position and edge paths
    dragStartPosition.value = undefined
    dragStartEdgePaths.value = undefined
    cursorMode.value = "default"
    selection.clearSelection()

    for (const node of nodes) {
      if (node.type === "instance") {
        handleInstanceDrag(node)
      } else if (node.type === "hub") {
        handleHubDrag(node)
      }
    }
  })

  return {
    onInstanceMoved,
    onHubMoved,
  }
}
