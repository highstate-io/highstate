<script setup lang="ts">
import type { AccessRequirement } from "../../../utils/access-control"

const {
  icon,
  tooltip,
  variant = "text",
  size = "small",
  color,
  disabled = false,
  access,
} = defineProps<{
  icon: string
  tooltip: string
  variant?: "text" | "outlined" | "flat" | "elevated" | "tonal" | "plain"
  size?: "x-small" | "small" | "default" | "large" | "x-large"
  color?: string
  disabled?: boolean
  access?: AccessRequirement | AccessRequirement[]
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <VTooltip location="top">
    <template #activator="{ props: tooltipProps }">
      <VBtn
        v-access="access"
        v-bind="tooltipProps"
        :icon="icon"
        :aria-label="tooltip"
        :variant="variant"
        :size="size"
        :color="color"
        :disabled="disabled"
        @click="$emit('click')"
      />
    </template>
    <span>{{ tooltip }}</span>
  </VTooltip>
</template>
