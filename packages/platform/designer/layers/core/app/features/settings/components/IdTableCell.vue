<script setup lang="ts">
import { formatShortId } from "../business/formatters"

const { copyFullText = "Copy full ID", truncate = true } = defineProps<{
  value: string
  truncate?: boolean
  copyFullText?: string
}>()

const { copy } = useClipboard()
</script>

<template>
  <div class="d-flex align-center">
    <code class="text-caption text-medium-emphasis font-mono mr-2">
      {{ truncate ? formatShortId(value) : value }}
    </code>
    <VBtn icon="mdi-content-copy" variant="text" size="x-small" @click="copy(value)">
      <VIcon size="16">mdi-content-copy</VIcon>
      <VTooltip activator="parent" location="top">{{ copyFullText }}</VTooltip>
    </VBtn>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: "Courier New", monospace;
}
</style>
