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

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

await projectPanelStore.initialize()
onMounted(projectPanelStore.placeNodes)

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
