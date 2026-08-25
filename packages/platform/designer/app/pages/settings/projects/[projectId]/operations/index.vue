<script setup lang="ts">
import { SettingsListPage, OperationsTable } from "#layers/core/app/features/settings"

const settingsStore = useProjectOperationSettingsStore()
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

void settingsStore.items.load()
</script>

<template>
  <SettingsListPage
    title="Operations"
    icon="mdi-cog-sync"
    description="Manage and monitor operations executed within this project."
  >
    <template #default="{ height }">
      <OperationsTable
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
