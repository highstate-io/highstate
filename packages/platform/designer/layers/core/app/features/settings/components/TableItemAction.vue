<script setup lang="ts">
const {
  icon,
  tooltip,
  variant = "text",
  size = "small",
  color,
  disabled = false,
} = defineProps<{
  icon: string
  tooltip: string
  variant?: "text" | "outlined" | "flat" | "elevated" | "tonal" | "plain"
  size?: "x-small" | "small" | "default" | "large" | "x-large"
  color?: string
  disabled?: boolean
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <VTooltip location="top">
    <template #activator="{ props: tooltipProps }">
      <VBtn
        v-bind="tooltipProps"
        :icon="icon"
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