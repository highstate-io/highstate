<script setup lang="ts">
import type { ComponentModel } from "@highstate/contract"
import ComponentIcon from "./ComponentIcon.vue"
import type { BlueprintStatus } from "#layers/core/app/features/blueprint"

const {
  component,
  blueprintStatus = "default",
  selected = false,
} = defineProps<{
  component: ComponentModel
  subtitle?: string
  text?: string
  blueprintStatus?: BlueprintStatus
  selected?: boolean
}>()

defineSlots<{
  default?: []
  append?: []
}>()

/**
 * Get the card styling based on visual status for Factorio-style blueprint placement
 */
const cardStyle = computed(() => {
  const baseStyle = {
    borderRadius: "4px",
  }

  switch (blueprintStatus) {
    case "blueprint-valid":
      return {
        ...baseStyle,
        opacity: "0.7",
        outline: "2px solid #4CAF50",
        backgroundColor: "rgba(76, 175, 80, 0.1)",
        boxShadow: "0 0 10px rgba(76, 175, 80, 0.3)",
      }
    case "blueprint-invalid":
      return {
        ...baseStyle,
        opacity: "0.7",
        outline: "2px solid #F44336",
        backgroundColor: "rgba(244, 67, 54, 0.1)",
        boxShadow: "0 0 10px rgba(244, 67, 54, 0.3)",
      }
  }

  if (selected) {
    return {
      ...baseStyle,
      outline: "2px solid #2196F3",
      boxShadow: "0 0 8px rgba(33, 150, 243, 0.4)",
    }
  }

  return baseStyle
})

const cardColor = computed(() => {
  // For blueprint states, use a more neutral color to show the semi-transparent effect
  if (blueprintStatus !== "default") {
    return "#424242"
  }

  return component.meta.color ?? "#2d2d2d"
})
</script>

<template>
  <VCard
    :width="360"
    :title="component.meta.title"
    :subtitle="subtitle"
    :text="text"
    :color="cardColor"
    :style="cardStyle"
    variant="flat"
  >
    <template #prepend>
      <ComponentIcon :meta="component.meta" />
    </template>

    <template #append>
      <slot name="append" />
    </template>

    <slot />
  </VCard>
</template>
