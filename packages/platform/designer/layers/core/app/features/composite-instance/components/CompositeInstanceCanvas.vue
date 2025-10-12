<script setup lang="ts">
import { EditorLoaderPopup, HubNodeWrapper, GenericCanvas } from "#layers/core/app/features/canvas"
import { InstanceNodeWrapper } from "#layers/core/app/features/instance-node"
import CompositeInstanceInputNode from "./CompositeInstanceInputNode.vue"
import CompositeInstanceOutputNode from "./CompositeInstanceOutputNode.vue"

const { projectStore, instancesStore, libraryStore } = useProjectStores()
const compositeStore = useCompositeStore()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

await compositeStore.initialize()
onMounted(compositeStore.placeNodes)
</script>

<template>
  <GenericCanvas
    :canvasId="['instance', projectStore.projectId, compositeStore.stateId, compositeStore.version]"
    :components="libraryStore.library.components"
    :entities="libraryStore.library.entities"
    :input-resolver-outputs="instancesStore.inputResolverOutputs"
    editable
  >
    <template #node-instance="props">
      <InstanceNodeWrapper v-bind="props" />
    </template>

    <template #node-inputs="props">
      <CompositeInstanceInputNode
        v-if="compositeStore.instance"
        v-bind="props"
        :instance="compositeStore.instance"
      />
    </template>

    <template #node-outputs="props">
      <CompositeInstanceOutputNode
        v-if="compositeStore.instance"
        v-bind="props"
        :instance="compositeStore.instance"
        type="outputs"
      />
    </template>

    <template #node-hub="props">
      <HubNodeWrapper v-bind="props" />
    </template>

    <template #panel-bottom-left>
      <EditorLoaderPopup />
    </template>
  </GenericCanvas>
</template>

<style scoped>
.vue-flow-container {
  display: flex;
  flex: 1;
  height: 100%;
}
</style>
