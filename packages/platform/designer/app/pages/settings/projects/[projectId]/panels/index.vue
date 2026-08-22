<script setup lang="ts">
import { PanelsTable, SettingsListPage } from "#layers/core/app/features/settings"

const { settingsStore, projectStore } = useProjectStores()

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

void settingsStore.panels.load()
</script>

<template>
  <SettingsListPage
    title="Panels"
    icon="mdi-view-dashboard-outline"
    description="View and open web panels attached to unit instances."
  >
    <template #default="{ height }">
      <PanelsTable
        v-model:search="settingsStore.panels.search"
        v-model:sort-by="settingsStore.panels.sortBy"
        v-model:page="settingsStore.panels.page"
        v-model:items-per-page="settingsStore.panels.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.panels.data"
        :loading="settingsStore.panels.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
