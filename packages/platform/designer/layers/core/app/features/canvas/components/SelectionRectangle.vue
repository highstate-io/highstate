<script setup lang="ts">
import type { Rect } from "@vue-flow/core"
import type { SelectionMode } from "../business"

const { selectionMode = "add", selectionArea } = defineProps<{
  selectionMode: SelectionMode | undefined
  selectionArea: Rect | undefined
}>()

const style = computed(() => {
  if (!selectionArea) {
    return undefined
  }

  const baseStyle = {
    left: selectionArea.x + "px",
    top: selectionArea.y + "px",
    width: selectionArea.width + "px",
    height: selectionArea.height + "px",
  }

  if (selectionMode === "add") {
    return {
      ...baseStyle,
      border: "2px dashed #2196F3",
      background: "rgba(33, 150, 243, 0.1)",
    }
  } else {
    return {
      ...baseStyle,
      border: "2px dashed #F44336",
      background: "rgba(244, 67, 54, 0.1)",
    }
  }
})
</script>

<template>
  <div v-if="style" class="selection-rectangle" :style="style" />
</template>

<style scoped>
.selection-rectangle {
  position: fixed;
  pointer-events: none;
  z-index: 1000;
}
</style>
