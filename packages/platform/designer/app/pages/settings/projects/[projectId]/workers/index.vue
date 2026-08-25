<script setup lang="ts">
import { SettingsListPage, WorkersTable } from "#layers/core/app/features/settings"

const { projectStore } = useProjectStores()
const settingsStore = useProjectWorkerSettingsStore()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.items.load()

definePageMeta({
  name: "settings.workers",
  tab: {
    label: "Workers",
    icon: "mdi-progress-wrench",
    order: 16,
    subpages: ["settings.worker-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Workers"
    icon="mdi-progress-wrench"
    description="Manage the workers that are processing tasks and operations in your project."
  >
    <template #default="{ height }">
      <WorkersTable
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
