<script setup lang="ts">
import { useNode, type GraphNode } from "@vue-flow/core"
import GenericContextMenu from "./GenericContextMenu.vue"
import ContextMenuItem from "./ContextMenuItem.vue"

const { title, subtitle, isDeletable } = defineProps<{
  title: string
  subtitle: string
  isDeletable: (node: GraphNode) => boolean
}>()

const { selection, vueFlowStore, deleteNodes } = useCanvasStore()

const visible = defineModel<boolean>("visible", { default: false })
const node = useNode()

const contextMenu = useTemplateRef("contextMenu")

const showContextMenu = async (event: MouseEvent) => {
  if (!contextMenu.value) return

  await contextMenu.value.showContextMenu(event)
}

const { off: offViewportChange } = vueFlowStore.onViewportChange(() => {
  visible.value = false
})

onUnmounted(() => {
  offViewportChange()
  visible.value = false
})

defineExpose({ showContextMenu })

const nodesToDelete = computed(() => {
  // only show delete option if this node is deletable, even if other deletable nodes are selected
  if (!isDeletable(node.node)) {
    return []
  }

  // 1. the action is on the current node
  if (!selection.selectedNodeIds.has(node.id)) {
    return [node.node]
  }

  // 2. the action is on multiple nodes
  return Array.from(selection.selectedNodes).filter(isDeletable)
})

const deleteText = computed(() => {
  if (nodesToDelete.value.length === 1) {
    return "Delete"
  }

  return `Delete selected (${nodesToDelete.value.length})`
})
</script>

<template>
  <GenericContextMenu
    ref="contextMenu"
    v-model:visible="visible"
    :title="title"
    :subtitle="subtitle"
  >
    <template v-if="$slots.default">
      <VDivider />
      <slot />
    </template>

    <template v-if="nodesToDelete.length > 0">
      <VDivider />

      <ContextMenuItem
        :title="deleteText"
        icon="mdi-delete"
        color="error"
        @click="deleteNodes(nodesToDelete)"
      />
    </template>
  </GenericContextMenu>
</template>
