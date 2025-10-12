import { getIncomers, useVueFlow, type GraphEdge, type GraphNode } from "@vue-flow/core"
import {
  useBlueprintClipboard,
  useBlueprintPlacement,
  type Blueprint,
} from "#layers/core/app/features/blueprint"
import {
  useCanvasSelection,
  useNodeFactory,
  useNodeMovement,
  type CursorMode,
  type HubNodeData,
  type InstanceNodeData,
} from "#layers/core/app/features/canvas"
import type { HubModel, InstanceModel } from "@highstate/contract"

export type CanvasId =
  | [type: "project", projectId: string]
  | [type: "instance", projectId: string, stateId: string, version: number]
  | [type: "custom", id: string]

export const useCanvasStore = defineMultiStore({
  name: "canvas",

  getStoreId: (...canvasId: CanvasId) => {
    if (canvasId[0] === "custom") {
      return `canvas/${canvasId[1]}`
    }

    if (canvasId[0] === "project") {
      return `projects/${canvasId[1]}/canvas`
    }

    return `projects/${canvasId[1]}/composites/${canvasId[2]}/${canvasId[3]}/canvas`
  },

  create: ({ storeId, id: [type, projectId] }) => {
    return defineStore(storeId, () => {
      const vueFlowStore = useVueFlow(storeId)
      const nodeFactory = useNodeFactory(vueFlowStore)

      const cursorMode = ref<CursorMode>("default")
      const blueprint = ref<Blueprint | undefined>()

      const { on: onNodesMoved, trigger: triggerNodesMoved } =
        createEventHook<[GraphNode[], GraphEdge[]]>()

      const { on: onInstanceNodeDeleted, trigger: triggerInstanceNodeDeleted } =
        createEventHook<GraphNode<InstanceNodeData>>()

      const { on: onHubNodeDeleted, trigger: triggerHubNodeDeleted } =
        createEventHook<GraphNode<HubNodeData>>()

      vueFlowStore.onNodeDrag(event => triggerNodesMoved(event.nodes, []))

      // prevent selection when multiple panels are open
      let selectionActive: ComputedRef<boolean>
      if (type === "project") {
        const router = useRouter()

        selectionActive = computed(() => {
          return (
            router.currentRoute.value.name === "project" &&
            router.currentRoute.value.params.projectId === projectId
          )
        })
      } else if (type === "instance") {
        const router = useRouter()

        selectionActive = computed(() => {
          return (
            router.currentRoute.value.name === "composite-instance" &&
            router.currentRoute.value.params.projectId === projectId
          )
        })
      } else {
        selectionActive = computed(() => true)
      }

      const selection = useCanvasSelection(vueFlowStore, cursorMode, selectionActive)

      const { onInstanceMoved, onHubMoved } = useNodeMovement(vueFlowStore, cursorMode, selection)

      const { copied: blueprintCopied } = useBlueprintClipboard(
        vueFlowStore,
        cursorMode,
        blueprint,
        selection,
        // TODO: find out why events are not triggered when using vueFlowRef
        // vueFlowStore.vueFlowRef,
        window.document,
      )

      const deleteNode = async (node: GraphNode) => {
        if (node.data.instance) {
          await triggerInstanceNodeDeleted(node as GraphNode<InstanceNodeData>)
        } else if (node.data.hub) {
          await triggerHubNodeDeleted(node as GraphNode<HubNodeData>)
        }
      }

      if (type === "project") {
        const { instancesStore } = useExplicitProjectStores(projectId)

        // enable blueprint placement only for project canvases
        useBlueprintPlacement(
          vueFlowStore,
          nodeFactory,
          instancesStore,
          cursorMode,
          blueprint,
          triggerNodesMoved,
          deleteNode,
        )
      }

      const deleteNodes = (nodes: GraphNode[]) => {
        if (nodes.length === 0) {
          return
        }

        // clear the selection and reset cursor mode
        cursorMode.value = "default"
        selection.clearSelection()

        // trigger the event hook to perform the actual deletion
        for (const node of nodes) {
          void deleteNode(node)
        }
      }

      const updateInstanceNode = (instance: InstanceModel) => {
        const nodeId = nodeFactory.instanceIdToNodeIdMap.get(instance.id)
        const node = vueFlowStore.findNode(nodeId)
        if (!node) {
          throw new Error(`Node with id ${instance.id} not found`)
        }

        vueFlowStore.updateNodeData(node.id, { instance })

        if (instance.position) {
          vueFlowStore.updateNode(node.id, { position: instance.position })
        }

        const nodeEdges = getIncomers(vueFlowStore, vueFlowStore.nodes.value)
        const createdEdgeIds = nodeFactory.createEdgesForInstance(instance)

        const orphanedEdges = nodeEdges.filter(edge => !createdEdgeIds.includes(edge.id))
        for (const edge of orphanedEdges) {
          vueFlowStore.removeEdges(edge.id)
        }
      }

      const updateHubNode = (hub: HubModel) => {
        const node = vueFlowStore.findNode(hub.id)
        if (!node) {
          throw new Error(`Node with id ${hub.id} not found`)
        }

        vueFlowStore.updateNodeData(node.id, { hub })
        vueFlowStore.updateNode(node.id, { position: hub.position })

        const nodeEdges = getIncomers(vueFlowStore, vueFlowStore.nodes.value)
        const createdEdgeIds = nodeFactory.createEdgesForHub(hub)

        const orphanedEdges = nodeEdges.filter(edge => !createdEdgeIds.includes(edge.id))
        for (const edge of orphanedEdges) {
          vueFlowStore.removeEdges(edge.id)
        }
      }

      onDeactivated(() => {
        vueFlowStore.$destroy()
      })

      return {
        nodeFactory: markRaw(nodeFactory),
        vueFlowStore: markRaw(vueFlowStore),

        cursorMode,
        selection,
        blueprint,
        blueprintCopied,

        updateInstanceNode,
        updateHubNode,

        onInstanceMoved,
        onHubMoved,

        onInstanceNodeDeleted,
        onHubNodeDeleted,

        onNodesMoved,

        deleteNodes,
      }
    })
  },
})

export type CanvasStore = ReturnType<typeof useCanvasStore>
