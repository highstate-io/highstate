<script setup lang="ts">
import { CustomEdge, SelectionRectangle } from "#layers/core/app/features/canvas"
import { Panel, VueFlow, type NodeProps } from "@vue-flow/core"
import type { InputResolverOutput } from "@highstate/backend/shared"
import type { ComponentModel, EntityModel } from "@highstate/contract"
import { Background } from "@vue-flow/background"
import { MiniMap } from "@vue-flow/minimap"

const {
  canvasId,
  editable = false,
  minimap = true,
  interactive = true,
  inputResolverOutputs,
} = defineProps<{
  canvasId: CanvasId
  inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>
  components: Record<string, ComponentModel>
  entities: Record<string, EntityModel>
  interactive?: boolean
  editable?: boolean
  minimap?: boolean
}>()

const emit = defineEmits<{
  dragover: [event: DragEvent]
  init: [canvasStore: CanvasStore]
}>()

defineSlots<{
  "node-hub"(props: NodeProps): VNode
  "node-instance"(props: NodeProps): VNode
  "node-inputs"(props: NodeProps): VNode
  "node-outputs"(props: NodeProps): VNode
  "panel-bottom-left"(): VNode
  "panel-bottom-right"(): VNode
}>()

const canvasStore = useCanvasStore.ensureCreated(...canvasId)

watchEffect(() => {
  canvasStore.edgeEndpointOffsets.setInputResolverOutputs(inputResolverOutputs)
})
emit("init", canvasStore)
</script>

<template>
  <ClientOnly>
    <div class="vue-flow-container">
      <VueFlow
        :min-zoom="0.1"
        :max-zoom="1"
        :snap-to-grid="true"
        @dragover="emit('dragover', $event)"
      >
        <Background pattern-color="#aaa" :gap="32" />
        <MiniMap v-if="minimap" position="top-right" />

        <template #node-instance="props">
          <slot name="node-instance" v-bind="props" />
        </template>

        <template #node-inputs="props">
          <slot name="node-inputs" v-bind="props" />
        </template>

        <template #node-outputs="props">
          <slot name="node-outputs" v-bind="props" />
        </template>

        <template #node-hub="props">
          <slot name="node-hub" v-bind="props" />
        </template>

        <template #edge-custom="props">
          <CustomEdge
            v-bind="props"
            :input-resolver-outputs="inputResolverOutputs"
            :components="components"
            :entities="entities"
          />
        </template>

        <Panel position="top-left">
          <div v-if="interactive">
            Hold Control to add nodes to selection and Alt to remove them
            <br />

            <div v-if="editable">Press Ctrl+V to paste blueprint from clipboard</div>

            <div v-if="canvasStore.selection.selectedNodeIds.size > 0">
              Selected {{ canvasStore.selection.selectedNodeIds.size }} nodes
              <br />
              Press Escape to clear selection
              <br />
              Press Ctrl+C to copy selected nodes to clipboard
            </div>
          </div>
        </Panel>

        <Panel position="bottom-right">
          <slot name="panel-bottom-right" />
        </Panel>

        <Panel position="bottom-left">
          <slot name="panel-bottom-left" />
        </Panel>

        <SelectionRectangle
          :selection-mode="canvasStore.selection.selectionMode"
          :selection-area="canvasStore.selection.selectionArea"
        />

        <VSnackbar v-model="canvasStore.blueprintCopied" location="top center" color="info">
          Blueprint copied to clipboard
        </VSnackbar>

        <!-- <BlueprintShareDialog :visible="false" :selected-nodes="[]" /> -->
      </VueFlow>
    </div>
  </ClientOnly>
</template>

<style scoped>
.vue-flow-container {
  display: flex;
  flex: 1;
  height: 100%;
}
</style>

<style>
/* import the necessary styles for Vue Flow to work */
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
</style>
