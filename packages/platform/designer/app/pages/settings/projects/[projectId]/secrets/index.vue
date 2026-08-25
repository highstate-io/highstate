<script setup lang="ts">
import { SettingsListPage, SecretsTable } from "#layers/core/app/features/settings"

const settingsStore = useProjectSecretSettingsStore()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.items.load()

definePageMeta({
  name: "settings.secrets",
  tab: {
    label: "Secrets",
    icon: "mdi-key-variant",
    order: 11,
    subpages: ["settings.secret-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Project Secrets"
    icon="mdi-key-variant"
    description="View and manage secrets for your project instances."
  >
    <template #default="{ height }">
      <SecretsTable
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
