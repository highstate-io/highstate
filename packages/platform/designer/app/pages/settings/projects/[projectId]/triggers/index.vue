<script setup lang="ts">
import { SettingsListPage, TriggersTable } from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

settingsStore.triggers.reset()

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
        v-model:search="settingsStore.triggers.search"
        v-model:sort-by="settingsStore.triggers.sortBy"
        v-model:page="settingsStore.triggers.page"
        v-model:items-per-page="settingsStore.triggers.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.triggers.data"
        :loading="settingsStore.triggers.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
