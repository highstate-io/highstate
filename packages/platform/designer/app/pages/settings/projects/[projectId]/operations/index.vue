<script setup lang="ts">
import { SettingsListPage, OperationsTable } from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

definePageMeta({
  name: "settings.operations",
  tab: {
    label: "Operations",
    icon: "mdi-cog-sync",
    order: 13,
    subpages: ["settings.operation-details"],
  },
})

void settingsStore.operations.load()
</script>

<template>
  <SettingsListPage
    title="Operations"
    icon="mdi-cog-sync"
    description="Manage and monitor operations executed within this project."
  >
    <template #default="{ height }">
      <OperationsTable
        v-model:search="settingsStore.operations.search"
        v-model:sort-by="settingsStore.operations.sortBy"
        v-model:page="settingsStore.operations.page"
        v-model:items-per-page="settingsStore.operations.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.operations.data"
        :loading="settingsStore.operations.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
