<script setup lang="ts">
import {
  SettingsListPage,
  ApiKeysTable,
} from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.apiKeys.load()

definePageMeta({
  name: "settings.api-keys",
  tab: {
    label: "API Keys",
    icon: "mdi-key-variant",
    order: 18,
    subpages: ["settings.api-key-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="API Keys"
    icon="mdi-key-variant"
    description="Manage the API keys that provide programmatic access to your project resources."
  >
    <template #default="{ height }">
      <ApiKeysTable
        v-model:search="settingsStore.apiKeys.search"
        v-model:sort-by="settingsStore.apiKeys.sortBy"
        v-model:page="settingsStore.apiKeys.page"
        v-model:items-per-page="settingsStore.apiKeys.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.apiKeys.data"
        :loading="settingsStore.apiKeys.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
