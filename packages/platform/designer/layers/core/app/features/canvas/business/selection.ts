import { getNodesInside, type GraphNode, type Rect, type VueFlowStore } from "@vue-flow/core"
import type { CursorMode } from "./shared"
import type { Reactive } from "vue"
import type { HubModel, InstanceModel } from "@highstate/contract"

export type SelectionMode = "add" | "remove"

export type CanvasSelection = ReturnType<typeof useCanvasSelection>

export function useCanvasSelection(
  vueFlowStore: VueFlowStore,
  cursorMode: Ref<CursorMode>,
  active: ComputedRef<boolean>,
) {
  const { escape, control, alt } = useMagicKeys()

  const selectionMode = ref<SelectionMode>()
  const startPosition = ref<{ x: number; y: number }>()
  const mousePosition = useMouse()

  const permanentSelectionSet = reactive(new Set<string>())

  watch([control, alt], ([control, alt]) => {
    if (!active.value) return

    if (cursorMode.value === "default" && control && !selectionMode.value) {
      // start "add" selection mode when control is pressed and no mode is set
      startSelection("add")
      return
    }

    if (cursorMode.value === "default" && alt && !selectionMode.value) {
      // start "remove" selection mode when alt is pressed and no mode is set
      startSelection("remove")
      return
    }

    if (!control && selectionMode.value === "add") {
      // end "add" selection mode when control is released
      commitSelection()
      return
    }

    if (!alt && selectionMode.value === "remove") {
      // end "remove" selection mode when alt is released
      commitSelection()
      return
    }
  })

  watch(escape, pressed => {
    if (!active.value) return

    if (pressed) {
      // clear selection when escape is pressed
      selectionMode.value = undefined
      startPosition.value = undefined
      cursorMode.value = "default" // reset cursor mode to default
      clearSelection()
    }
  })

  watch(cursorMode, mode => {
    if (!active.value) return

    if (mode !== "selection") {
      // reset selection mode when cursor mode changes
      selectionMode.value = undefined
      startPosition.value = undefined
    }
  })

  const startSelection = (mode: SelectionMode) => {
    selectionMode.value = mode
    startPosition.value = { x: mousePosition.x.value, y: mousePosition.y.value }

    // set the cursor mode to selection to prevent other interactions
    cursorMode.value = "selection"
  }

  const commitSelection = () => {
    try {
      const selectedNodes = getNodesInside(
        vueFlowStore.nodes.value,
        selectionArea.value!,
        vueFlowStore.viewport.value,
        true,
      )

      // update the permanent selection set based on the current selection mode
      for (const node of selectedNodes) {
        if (selectionMode.value === "add") {
          permanentSelectionSet.add(node.id)
        } else {
          permanentSelectionSet.delete(node.id)
        }
      }

      if (selectionMode.value === "add") {
        vueFlowStore.addSelectedNodes(selectedNodes)
      } else {
        vueFlowStore.removeSelectedNodes(selectedNodes)
      }
    } finally {
      selectionMode.value = undefined
      startPosition.value = undefined
      cursorMode.value = "default" // reset cursor mode to default
    }
  }

  const isSelecting = computed(() => startPosition.value !== undefined && control.value)

  const selectionArea = computed(() => {
    if (!startPosition.value) return undefined

    return {
      x: Math.min(startPosition.value.x, mousePosition.x.value),
      y: Math.min(startPosition.value.y, mousePosition.y.value),
      width: Math.abs(mousePosition.x.value - startPosition.value.x),
      height: Math.abs(mousePosition.y.value - startPosition.value.y),
    } satisfies Rect
  })

  const isNodeSelected = (node: GraphNode): boolean => {
    if (!selectionArea.value) {
      // if no selection area is defined, use the permanent selection set
      return permanentSelectionSet.has(node.id)
    }

    const nodesInside = getNodesInside(
      [node],
      selectionArea.value,
      vueFlowStore.viewport.value,
      true,
    )

    const currentlySelected = nodesInside.length > 0

    // display the next state of the node when the selection area is committed
    return selectionMode.value === "add"
      ? currentlySelected || permanentSelectionSet.has(node.id)
      : !currentlySelected && permanentSelectionSet.has(node.id)
  }

  const clearSelection = () => {
    vueFlowStore.removeSelectedElements()
    permanentSelectionSet.clear()
  }

  const selectedNodes = computed(() => {
    return Array.from(permanentSelectionSet)
      .map(id => vueFlowStore.findNode(id))
      .filter(node => node !== undefined)
  })

  const selectedInstances = computed<InstanceModel[]>(() => {
    return selectedNodes.value.filter(node => node.data.instance).map(node => node.data.instance!)
  })

  const selectedHubs = computed<HubModel[]>(() => {
    return selectedNodes.value.filter(node => node.data.hub).map(node => node.data.hub!)
  })

  return {
    isSelecting,
    selectionArea,
    selectionMode,
    isNodeSelected,
    selectedNodeIds: permanentSelectionSet as Reactive<ReadonlySet<string>>,
    selectedNodes,
    selectedInstances,
    selectedHubs,
    clearSelection,
  }
}
