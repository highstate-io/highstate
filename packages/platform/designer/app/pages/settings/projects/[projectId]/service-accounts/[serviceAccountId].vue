<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  RelatedDataPanel,
  TimeTableCell,
  IdTableCell,
  ApiKeysTable,
  TerminalsTable,
  PagesTable,
  SecretsTable,
  WorkersTable,
  ArtifactsTable,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    serviceAccountId: string
  }
}>()

definePageMeta({
  name: "settings.service-account-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const serviceAccount = await settingsStore.getServiceAccountDetails(params.serviceAccountId)

if (!serviceAccount) {
  throw createError({
    statusCode: 404,
    statusMessage: "Service Account not found",
  })
}

const detailItems = [
  { key: "serviceAccountId", label: "Service Account ID" },
  { key: "name", label: "Name" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]

// Load related data
const apiKeys = settingsStore.apiKeysForServiceAccount(params.serviceAccountId)
const terminals = settingsStore.terminalsForServiceAccount(params.serviceAccountId)
const pages = settingsStore.pagesForServiceAccount(params.serviceAccountId)
const secrets = settingsStore.secretsForServiceAccount(params.serviceAccountId)
const workers = settingsStore.workersForServiceAccount(params.serviceAccountId)
const artifacts = settingsStore.artifactsForServiceAccount(params.serviceAccountId)

void apiKeys.load()
void terminals.load()
void pages.load()
void secrets.load()
void workers.load()
void artifacts.load()

</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="serviceAccount.meta"
      fallback-icon="mdi-account-circle"
      :title="serviceAccount.meta.title"
      :description="serviceAccount.meta.description"
    />

    <DetailInfoCard title="Service Account Details" :items="detailItems">
      <template #item.serviceAccountId>
        <IdTableCell :value="serviceAccount.id" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="serviceAccount.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="serviceAccount.updatedAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <!-- API Keys Panel -->
      <RelatedDataPanel
        title="API Keys"
        icon="mdi-key-variant"
        :count="apiKeys.data.value.total"
      >
        <ApiKeysTable
          v-model:search="apiKeys.search.value"
          v-model:sort-by="apiKeys.sortBy.value"
          v-model:page="apiKeys.page.value"
          v-model:items-per-page="apiKeys.itemsPerPage.value"
          :project-id="params.projectId"
          :data="apiKeys.data.value"
          :loading="apiKeys.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Terminals Panel -->
      <RelatedDataPanel
        title="Terminals"
        icon="mdi-console"
        :count="terminals.data.value.total"
      >
        <TerminalsTable
          v-model:search="terminals.search.value"
          v-model:sort-by="terminals.sortBy.value"
          v-model:page="terminals.page.value"
          v-model:items-per-page="terminals.itemsPerPage.value"
          :project-id="params.projectId"
          :data="terminals.data.value"
          :loading="terminals.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Pages Panel -->
      <RelatedDataPanel
        title="Pages"
        icon="mdi-file-document-outline"
        :count="pages.data.value.total"
      >
        <PagesTable
          v-model:search="pages.search.value"
          v-model:sort-by="pages.sortBy.value"
          v-model:page="pages.page.value"
          v-model:items-per-page="pages.itemsPerPage.value"
          :project-id="params.projectId"
          :data="pages.data.value"
          :loading="pages.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Secrets Panel -->
      <RelatedDataPanel
        title="Secrets"
        icon="mdi-key-variant"
        :count="secrets.data.value.total"
      >
        <SecretsTable
          v-model:search="secrets.search.value"
          v-model:sort-by="secrets.sortBy.value"
          v-model:page="secrets.page.value"
          v-model:items-per-page="secrets.itemsPerPage.value"
          :project-id="params.projectId"
          :data="secrets.data.value"
          :loading="secrets.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Workers Panel -->
      <RelatedDataPanel
        title="Workers"
        icon="mdi-progress-wrench"
        :count="workers.data.value.total"
      >
        <WorkersTable
          v-model:search="workers.search.value"
          v-model:sort-by="workers.sortBy.value"
          v-model:page="workers.page.value"
          v-model:items-per-page="workers.itemsPerPage.value"
          :project-id="params.projectId"
          :data="workers.data.value"
          :loading="workers.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>

      <!-- Artifacts Panel -->
      <RelatedDataPanel
        title="Artifacts"
        icon="mdi-package-variant"
        :count="artifacts.data.value.total"
      >
        <ArtifactsTable
          v-model:search="artifacts.search.value"
          v-model:sort-by="artifacts.sortBy.value"
          v-model:page="artifacts.page.value"
          v-model:items-per-page="artifacts.itemsPerPage.value"
          :project-id="params.projectId"
          :data="artifacts.data.value"
          :loading="artifacts.isLoading.value"
          hide-header
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>
</template>
