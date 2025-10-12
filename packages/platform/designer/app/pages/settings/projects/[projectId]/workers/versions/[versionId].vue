<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { StatusChip, workerVersionStatusMap, ApiKeyRefChip } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    workerId: string
    versionId: string
  }
}>()

definePageMeta({
  name: "settings.worker-version-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const version = await settingsStore.getWorkerVersionDetails(params.versionId)

if (!version) {
  throw createError({
    statusCode: 404,
    statusMessage: "Worker version not found",
  })
}

const detailItems = [
  { key: "versionId", label: "Version ID" },
  { key: "status", label: "Status" },
  { key: "digest", label: "Digest" },
  { key: "enabled", label: "Enabled" },
  { key: "apiKey", label: "API Key" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="version.meta"
      fallback-icon="mdi-source-branch"
      :title="version.meta.title || `Version ${version.id.slice(0, 8)}`"
      :description="version.meta.description"
    >
      <template #actions>
        <VBtn
          variant="outlined"
          prepend-icon="mdi-console"
          @click="
            navigateTo({
              name: 'worker-version-logs',
              params: {
                projectId: params.projectId,
                workerVersionId: params.versionId,
              },
            })
          "
        >
          View Logs
        </VBtn>
      </template>
    </SettingsPageHeader>

    <DetailInfoCard title="Version Details" :items="detailItems">
      <template #item.versionId>
        <IdTableCell :value="version.id" />
      </template>

      <template #item.status>
        <StatusChip :status="version.status" :status-map="workerVersionStatusMap" />
      </template>

      <template #item.digest>
        <IdTableCell :value="version.digest" copy-full-text="Copy full digest" />
      </template>

      <template #item.enabled>
        <VChip
          size="small"
          :color="version.enabled ? 'success' : 'secondary'"
          class="text-uppercase"
        >
          {{ version.enabled ? "Enabled" : "Disabled" }}
        </VChip>
      </template>

      <template #item.apiKey>
        <ApiKeyRefChip :item="version" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="version.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="version.updatedAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>
