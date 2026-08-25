<script setup lang="ts">
import { PanelsTable, SettingsListPage } from "#layers/core/app/features/settings"

const { projectStore } = useProjectStores()
const settingsStore = useProjectPanelSettingsStore()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

definePageMeta({
  name: "settings.panels",
  tab: {
    label: "Panels",
    icon: "mdi-view-dashboard-outline",
    order: 13,
    subpages: ["settings.panel-details"],
  },
})

void settingsStore.items.load()
</script>

<template>
  <SettingsListPage
    title="Panels"
    icon="mdi-view-dashboard-outline"
    description="View and open web panels attached to unit instances."
  >
    <template #default="{ height }">
      <PanelsTable
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
