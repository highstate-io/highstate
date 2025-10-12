<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  RelatedDataPanel,
  WorkerVersionsTable,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import {
  ServiceAccountRefChip,
} from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    workerId: string
  }
}>()

definePageMeta({
  name: "settings.worker-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const worker = await settingsStore.getWorkerDetails(params.workerId)

if (!worker) {
  throw createError({
    statusCode: 404,
    statusMessage: "Worker not found",
  })
}

const detailItems = [
  { key: "workerId", label: "Worker ID" },
  { key: "identity", label: "Identity" },
  { key: "serviceAccount", label: "Service Account" },
  { key: "createdAt", label: "Created" },
]

// Load related data
const versions = settingsStore.versionsForWorker(params.workerId)

void versions.load()

// Navigate to version logs
const viewVersionLogs = (versionId: string) => {
  navigateTo({
    name: 'worker-version-logs',
    params: {
      projectId: params.projectId,
      workerVersionId: versionId,
    },
  })
}
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="worker.meta"
      fallback-icon="mdi-progress-wrench"
      :title="worker.meta.title || worker.identity"
      :description="worker.meta.description"
    />

    <DetailInfoCard title="Worker Details" :items="detailItems">
      <template #item.workerId>
        <IdTableCell :value="worker.id" />
      </template>

      <template #item.identity>
        <div class="text-body-2">{{ worker.identity }}</div>
      </template>

      <template #item.serviceAccount>
        <ServiceAccountRefChip :item="worker" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="worker.createdAt" />
      </template>
    </DetailInfoCard>

    <!-- Expandable Content -->
    <VExpansionPanels :elevation="0">
      <!-- Worker Versions Panel -->
      <RelatedDataPanel
        title="Worker Versions"
        icon="mdi-source-branch"
        :count="versions.data.value.total"
      >
        <WorkerVersionsTable
          v-model:search="versions.search.value"
          v-model:sort-by="versions.sortBy.value"
          v-model:page="versions.page.value"
          v-model:items-per-page="versions.itemsPerPage.value"
          :project-id="params.projectId"
          :worker-id="params.workerId"
          :data="versions.data.value"
          :loading="versions.isLoading.value"
          :hide-header="true"
          @view-logs="viewVersionLogs"
        />
      </RelatedDataPanel>
    </VExpansionPanels>
  </DetailPageLayout>
</template>
