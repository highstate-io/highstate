<script setup lang="ts">
import { SettingsListPage, TriggersTable } from "#layers/core/app/features/settings"

const settingsStore = useProjectTriggerSettingsStore()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

settingsStore.items.reset()

definePageMeta({
  name: "settings.triggers",
  tab: {
    label: "Triggers",
    icon: "mdi-flash-outline",
    order: 14,
    subpages: ["settings.trigger-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Instance Triggers"
    icon="mdi-flash-outline"
    description="View and manage triggers created by project instances."
  >
    <template #default="{ height }">
      <TriggersTable
        v-model:search="settingsStore.items.search"
        v-model:sort-by="settingsStore.items.sortBy"
        v-model:page="settingsStore.items.page"
        v-model:items-per-page="settingsStore.items.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.items.data"
        :loading="settingsStore.items.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
