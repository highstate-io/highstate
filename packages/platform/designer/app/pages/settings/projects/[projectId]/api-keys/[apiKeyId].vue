<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { ServiceAccountRefChip } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    apiKeyId: string
  }
}>()

definePageMeta({
  name: "settings.api-key-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const apiKey = await settingsStore.getApiKeyDetails(params.apiKeyId)

if (!apiKey) {
  throw createError({
    statusCode: 404,
    statusMessage: "API Key not found",
  })
}

const detailItems = [
  { key: "apiKeyId", label: "API Key ID" },
  { key: "serviceAccount", label: "Service Account" },
  { key: "createdAt", label: "Created" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="apiKey.meta"
      fallback-icon="mdi-key-variant"
      :title="apiKey.meta.title || `API Key ${apiKey.id.slice(-8)}`"
      :description="apiKey.meta.description"
    />

    <DetailInfoCard title="API Key Details" :items="detailItems">
      <template #item.apiKeyId>
        <IdTableCell :value="apiKey.id" />
      </template>

      <template #item.serviceAccount>
        <ServiceAccountRefChip :item="apiKey" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="apiKey.createdAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>