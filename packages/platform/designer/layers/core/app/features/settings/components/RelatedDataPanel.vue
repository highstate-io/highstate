<script setup lang="ts">
const { title, icon, count } = defineProps<{
  title: string
  icon: string
  count: number
}>()
</script>

<template>
  <VExpansionPanel color="#2d2d2d" bg-color="#1e1e1e" class="related-data-panel">
    <template #title>
      <div class="d-flex align-center">
        <VIcon class="mr-2">{{ icon }}</VIcon>
        {{ title }}
        <VChip size="small" class="ml-2" variant="outlined">
          {{ count }}
        </VChip>
      </div>
    </template>

    <template #text>
      <slot />
    </template>
  </VExpansionPanel>
</template>

<style>
.related-data-panel > .v-expansion-panel-text > .v-expansion-panel-text__wrapper {
  padding: 0 !important;
}
</style>
