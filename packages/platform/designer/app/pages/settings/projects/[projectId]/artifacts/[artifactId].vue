<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
  RelatedDataPanel,
  ServiceAccountsTable,
  TerminalsTable,
  PagesTable,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { bytesToHumanReadable } from "@highstate/contract"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    artifactId: string
  }
}>()

definePageMeta({
  name: "settings.artifact-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const artifact = await settingsStore.getArtifactDetails(params.artifactId)

if (!artifact) {
  throw createError({
    statusCode: 404,
    statusMessage: "Artifact not found",
  })
}

// Load related data
const serviceAccounts = settingsStore.serviceAccountsForArtifact(params.artifactId)
const terminals = settingsStore.terminalsForArtifact(params.artifactId)
const pages = settingsStore.pagesForArtifact(params.artifactId)

void serviceAccounts.load()
void terminals.load()
void pages.load()

const detailItems = [
  { key: "artifactId", label: "Artifact ID" },
  { key: "hash", label: "Hash" },
  { key: "size", label: "Size" },
  { key: "createdAt", label: "Created" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="artifact.meta"
      fallback-icon="mdi-package-variant"
      :title="artifact.meta.title || 'Unnamed Artifact'"
      :description="artifact.meta.description"
    />

    <DetailInfoCard title="Artifact Details" :items="detailItems">
      <template #item.artifactId>
        <IdTableCell :value="artifact.id" />
      </template>

      <template #item.hash>
        <IdTableCell :value="artifact.hash" :truncate="true" copy-full-text="Copy full hash" />
      </template>

      <template #item.size>
        <div class="text-body-2">{{ bytesToHumanReadable(artifact.size) }}</div>
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="artifact.createdAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <!-- Service Accounts Panel -->
      <RelatedDataPanel
        title="Service Accounts"
        icon="mdi-account-circle"
        :count="serviceAccounts.data.value.total"
      >
        <ServiceAccountsTable
          v-model:search="serviceAccounts.search.value"
          v-model:sort-by="serviceAccounts.sortBy.value"
          v-model:page="serviceAccounts.page.value"
          v-model:items-per-page="serviceAccounts.itemsPerPage.value"
          :project-id="params.projectId"
          :data="serviceAccounts.data.value"
          :loading="serviceAccounts.isLoading.value"
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
    </VExpansionPanels>
  </DetailPageLayout>
</template>