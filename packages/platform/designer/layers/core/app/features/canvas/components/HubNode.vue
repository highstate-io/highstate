<script setup lang="ts">
import type { HubModel } from "@highstate/contract"
import { useNode, type ValidConnectionFunc } from "@vue-flow/core"
import { getBlueprintStatus } from "#layers/core/app/features/blueprint"
import HubCard from "./HubCard.vue"
import HubNodeHandle from "./HubNodeHandle.vue"

defineProps<{
  hub: HubModel
  isValidConnection?: ValidConnectionFunc
}>()

const emit = defineEmits<{
  contextmenu: [event: MouseEvent]
}>()

const { vueFlowStore, selection } = useCanvasStore()

const node = useNode()
const blueprintStatus = computed(() => getBlueprintStatus(node.node, vueFlowStore))
</script>

<template>
  <HubCard
    class="hub-card"
    :selected="selection.isNodeSelected(node.node)"
    :blueprint-status="blueprintStatus"
    @contextmenu="emit('contextmenu', $event)"
  >
    <slot />

    <div class="handles">
      <HubNodeHandle handle-color="#3F51B5" side="left" :is-valid-connection="isValidConnection" />
      <HubNodeHandle handle-color="#3F51B5" side="right" :is-valid-connection="isValidConnection" />
    </div>
  </HubCard>
</template>

<style scoped>
.handles {
  position: absolute;
  width: 100%;
  top: calc(50% - 15px);
}

.toolbar-button {
  position: absolute;
  min-width: 0;
  width: 32px;
  right: 0;
  bottom: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.hub-card:hover > .toolbar-button {
  opacity: 1;
}
</style>
