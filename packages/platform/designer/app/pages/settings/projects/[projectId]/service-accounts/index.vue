<script setup lang="ts">
import { SettingsListPage, ServiceAccountsTable } from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

void settingsStore.serviceAccounts.load()

definePageMeta({
  name: "settings.service-accounts",
  tab: {
    label: "Service Accounts",
    icon: "mdi-account-circle",
    order: 17,
    subpages: ["settings.service-account-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Service Accounts"
    icon="mdi-account-circle"
    description="Manage the service accounts that provide identities for automated processes and applications."
  >
    <template #default="{ height }">
      <ServiceAccountsTable
        v-model:search="settingsStore.serviceAccounts.search"
        v-model:sort-by="settingsStore.serviceAccounts.sortBy"
        v-model:page="settingsStore.serviceAccounts.page"
        v-model:items-per-page="settingsStore.serviceAccounts.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.serviceAccounts.data"
        :loading="settingsStore.serviceAccounts.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
