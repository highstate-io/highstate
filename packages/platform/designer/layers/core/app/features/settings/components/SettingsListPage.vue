<script setup lang="ts">
import SettingsPageHeader from "./SettingsPageHeader.vue"

const { title, icon, description } = defineProps<{
  title: string
  icon: string
  description?: string
}>()

const slots = defineSlots<{
  default?: (props: { height: string }) => VNode
  actions?: () => VNode
}>()

// TODO: calculate height for the table
const tableHeight = "calc(100vh - 285px)"
</script>

<template>
  <div class="settings-list-page">
    <!-- Unified Page Header -->
    <SettingsPageHeader :title="title" :fallback-icon="icon" :description="description">
      <template #actions>
        <slot name="actions" />
      </template>
    </SettingsPageHeader>

    <!-- Data Table -->
    <div class="table-container">
      <slot :height="tableHeight" />
    </div>
  </div>
</template>

<style scoped>
.settings-list-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 24px;
}

.table-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
