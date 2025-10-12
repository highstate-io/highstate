<script setup lang="ts">
import {
  SettingsListPage,
  WorkersTable,
} from "#layers/core/app/features/settings"

const { settingsStore, projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.workers.load()

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
        v-model:search="settingsStore.workers.search"
        v-model:sort-by="settingsStore.workers.sortBy"
        v-model:page="settingsStore.workers.page"
        v-model:items-per-page="settingsStore.workers.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.workers.data"
        :loading="settingsStore.workers.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
