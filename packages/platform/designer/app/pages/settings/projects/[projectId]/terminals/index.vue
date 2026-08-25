<script setup lang="ts">
import { SettingsListPage, TerminalsTable } from "#layers/core/app/features/settings"

const settingsStore = useProjectTerminalSettingsStore()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

definePageMeta({
  name: "settings.terminals",
  tab: {
    label: "Terminals",
    icon: "mdi-console",
    order: 12,
    subpages: ["settings.terminal-details"],
  },
})

void settingsStore.items.load()
</script>

<template>
  <SettingsListPage
    title="Terminals"
    icon="mdi-console"
    description="Manage terminals and terminal sessions for this project."
  >
    <template #default="{ height }">
      <TerminalsTable
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
