<script setup lang="ts">
import { Position, Handle, type ValidConnectionFunc } from "@vue-flow/core"

defineProps<{
  side: "left" | "right"
  handleColor?: string
  isValidConnection?: ValidConnectionFunc
}>()
</script>

<template>
  <Handle
    id=""
    :type="side === 'left' ? 'target' : 'source'"
    :position="side === 'left' ? Position.Left : Position.Right"
    class="handle"
    :class="[side === 'left' ? 'left-handle' : 'right-handle']"
    :is-valid-connection="isValidConnection"
  />
  <div
    class="handle-dot"
    :class="[side === 'left' ? 'handle-dot-left' : 'handle-dot-right']"
    :style="{ backgroundColor: handleColor }"
  />
</template>

<style scoped>
.handle {
  position: absolute;
  width: calc(25%);
  height: 30px;
  opacity: 0;
  cursor: cell !important;
  border-radius: 0;
}

.left-handle {
  transform: translateX(-6px);
}

.right-handle {
  transform: translateX(6px);
}

.handle-dot {
  position: absolute;
  width: 6px;
  height: 30px;
  color: inherit;
  background-color: inherit;
}

.handle-dot-left {
  left: -6px;
  border-radius: 4px 0 0 4px;
}

.handle-dot-right {
  right: -6px;
  border-radius: 0 4px 4px 0;
}

.vue-flow__handle-connecting:not(.vue-flow__handle-valid) + .handle-dot {
  background-color: rgb(var(--v-theme-error)) !important;
}
</style>
