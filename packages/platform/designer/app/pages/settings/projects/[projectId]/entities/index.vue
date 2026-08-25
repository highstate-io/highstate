<script setup lang="ts">
import { SettingsListPage, EntitiesTable } from "#layers/core/app/features/settings"

const { projectStore } = useProjectStores()
const settingsStore = useProjectEntitySettingsStore()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.items.load()

definePageMeta({
  name: "settings.entities",
  tab: {
    label: "Entities",
    icon: "mdi-database",
    order: 17,
    subpages: ["settings.entity-details", "settings.entity-snapshot-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Entities"
    icon="mdi-database"
    description="Browse entities produced by operations in your project."
  >
    <template #default="{ height }">
      <EntitiesTable
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
