<script setup lang="ts">
import { SettingsListPage, TerminalsTable } from "#layers/core/app/features/settings"

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
  name: "settings.terminals",
  tab: {
    label: "Terminals",
    icon: "mdi-console",
    order: 12,
    subpages: ["settings.terminal-details"],
  },
})

void settingsStore.terminals.load()
</script>

<template>
  <SettingsListPage
    title="Terminals"
    icon="mdi-console"
    description="Manage terminals and terminal sessions for this project."
  >
    <template #default="{ height }">
      <TerminalsTable
        v-model:search="settingsStore.terminals.search"
        v-model:sort-by="settingsStore.terminals.sortBy"
        v-model:page="settingsStore.terminals.page"
        v-model:items-per-page="settingsStore.terminals.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.terminals.data"
        :loading="settingsStore.terminals.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
