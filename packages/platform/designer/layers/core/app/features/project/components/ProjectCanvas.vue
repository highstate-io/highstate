<script setup lang="ts">
import {
  EditorLoaderPopup,
  ExtraElementPanel,
  HubNodeWrapper,
  GenericCanvas,
} from "#layers/core/app/features/canvas"
import { InstanceNodeWrapper } from "#layers/core/app/features/instance-node"
import { type Blueprint } from "#layers/core/app/features/blueprint"
import { getInstanceId } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { getComponentTypeFromDragData, isHubDragData } from "#layers/core/app/features/shared"

const canvasStore = useCanvasStore()
const projectPanelStore = useProjectPanelStore()
const { projectStore, instancesStore, libraryStore } = useProjectStores()
const logger = globalLogger.child({ feature: "project-canvas-focus" })

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

await projectPanelStore.initialize()

const focusInstanceInCanvas = async (instanceId: string) => {
  logger.debug({ instanceId }, "focus requested")

  await until(canvasStore.vueFlowStore.areNodesInitialized).toBe(true)
  await waitFor(
    () => {
      const nodeId = canvasStore.nodeFactory.instanceIdToNodeIdMap.get(instanceId)
      if (!nodeId) {
        return false
      }

      return Boolean(canvasStore.vueFlowStore.findNode(nodeId))
    },
    20,
    50,
  )

  const nodeId = canvasStore.nodeFactory.instanceIdToNodeIdMap.get(instanceId)
  if (!nodeId) {
    logger.debug({ instanceId }, "focus failed: node id not found in instance map")
    return false
  }

  const node = canvasStore.vueFlowStore.findNode(nodeId)
  if (!node) {
    logger.debug({ instanceId, nodeId }, "focus failed: vue-flow node not found")
    return false
  }

  const nodeCenterX = node.position.x + node.dimensions.width / 2
  const nodeCenterY = node.position.y + node.dimensions.height / 2
  const currentZoom = canvasStore.vueFlowStore.viewport.value.zoom

  await canvasStore.vueFlowStore.setCenter(nodeCenterX, nodeCenterY, {
    zoom: currentZoom,
    duration: 300,
  })

  logger.debug({ instanceId, nodeId, nodeCenterX, nodeCenterY }, "focus success")

  return true
}

const waitFor = async (predicate: () => boolean, attempts: number, delayMs: number) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}

onMounted(() => {
  projectPanelStore.placeNodes()
})

watch(
  () => projectPanelStore.instanceFocusRequest,
  async request => {
    if (!request) {
      return
    }

    logger.debug({ request }, "focus request changed")

    const focused = await focusInstanceInCanvas(request.instanceId)
    if (!focused) {
      logger.debug({ request }, "focus request kept for retry because focus did not succeed")
      return
    }

    projectPanelStore.clearInstanceFocusRequest(request.requestId)
  },
  { immediate: true },
)

const onDragOver = (event: DragEvent) => {
  event.preventDefault()

  if (!event.dataTransfer) return
  if (canvasStore.blueprint) return

  // transform the dragged object to blueprint
  let blueprint: Blueprint | undefined
  const componentType = getComponentTypeFromDragData(event.dataTransfer)

  if (componentType) {
    const name = instancesStore.getNextInstanceName(componentType)
    const id = getInstanceId(componentType, name)
    const component = libraryStore.library.components[componentType]

    blueprint = {
      boundary: {
        width: 360,
        height: 260,
      },
      instances: [
        {
          id,
          name,
          type: componentType,
          kind: component.kind,
          position: { x: 0, y: 0 },
        },
      ],
      hubs: [],
    }
  } else if (isHubDragData(event.dataTransfer)) {
    blueprint = {
      boundary: {
        width: 74,
        height: 74,
      },
      instances: [],
      hubs: [
        {
          id: createId(),
          position: { x: 0, y: 0 },
        },
      ],
    }
  } else {
    return
  }

  // the rest of the logic will be handled by the blueprint placement system
  canvasStore.blueprint = blueprint
}
</script>

<template>
  <GenericCanvas
    :canvasId="['project', projectStore.projectId]"
    :components="libraryStore.library.components"
    :entities="libraryStore.library.entities"
    :input-resolver-outputs="instancesStore.inputResolverOutputs"
    editable
    @dragover="onDragOver"
  >
    <template #node-instance="props">
      <InstanceNodeWrapper v-bind="props" />
    </template>

    <template #node-hub="props">
      <HubNodeWrapper v-bind="props" />
    </template>

    <template #panel-bottom-left>
      <EditorLoaderPopup />
    </template>

    <template #panel-bottom-right>
      <ExtraElementPanel />
    </template>
  </GenericCanvas>
</template>
