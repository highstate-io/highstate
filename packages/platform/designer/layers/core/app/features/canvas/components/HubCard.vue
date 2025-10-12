<script setup lang="ts">
import type { BlueprintStatus } from "#layers/core/app/features/blueprint"
import { getNodeCardStyle } from "../business"

defineProps<{
  selected?: boolean
  blueprintStatus?: BlueprintStatus
}>()
</script>

<template>
  <VCard variant="flat" :style="getNodeCardStyle(selected, blueprintStatus)" color="#2d2d2d">
    <VIcon class="ma-2" :size="74">mdi-router</VIcon>
    <slot />
  </VCard>
</template>
