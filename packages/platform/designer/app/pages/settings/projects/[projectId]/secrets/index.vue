<script setup lang="ts">
import { SettingsListPage, SecretsTable } from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.secrets.load()

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
        v-model:search="settingsStore.secrets.search"
        v-model:sort-by="settingsStore.secrets.sortBy"
        v-model:page="settingsStore.secrets.page"
        v-model:items-per-page="settingsStore.secrets.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.secrets.data"
        :loading="settingsStore.secrets.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
