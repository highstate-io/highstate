<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
  RelatedDataPanel,
  ArtifactsTable,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { OwnerRefChip } from "#layers/core/app/features/shared"
import { PageContent } from "#layers/core/app/features/page-dialog"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    pageId: string
  }
}>()

definePageMeta({
  name: "settings.page-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const page = await settingsStore.getPageDetails(params.pageId)

if (!page) {
  throw createError({
    statusCode: 404,
    statusMessage: "Page not found",
  })
}

// load related data
const artifacts = settingsStore.artifactsForPage(params.pageId)
await artifacts.load()

const detailItems = [
  { key: "pageId", label: "Page ID" },
  { key: "name", label: "Name" },
  { key: "serviceAccount", label: "Owner" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="page.meta"
      fallback-icon="mdi-file-document-outline"
      :title="page.meta.title || page.name || 'Unnamed Page'"
      :description="page.meta.description"
    />

    <DetailInfoCard title="Page Details" :items="detailItems">
      <template #item.pageId>
        <IdTableCell :value="page.id" />
      </template>

      <template #item.name>
        <div class="text-body-2">{{ page.name || "N/A" }}</div>
      </template>

      <template #item.serviceAccount>
        <OwnerRefChip :item="page" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="page.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="page.updatedAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
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

    <!-- Page Content Section -->
    <VCard
      v-if="page.content && page.content.length > 0"
      class="content-card"
      color="#2d2d2d"
      bg-color="#1e1e1e"
    >
      <VCardTitle>Page Content</VCardTitle>
      <VCardText>
        <div class="page-content-container">
          <PageContent :content="page.content" />
        </div>
      </VCardText>
    </VCard>
  </DetailPageLayout>
</template>

<style scoped>
.content-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-shrink: 1;
}

.content-card :deep(.v-card-text) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.page-content-container {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-x: auto;
  flex: 1;
}

.page-content-container :deep(.d-flex.flex-row) {
  min-width: 0;
  flex-wrap: nowrap;
}

.page-content-container :deep(.qr-text) {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  flex-shrink: 1;
}

.page-content-container :deep(.md-content) {
  overflow-wrap: break-word;
  word-break: break-word;
  min-width: 0;
}
</style>
