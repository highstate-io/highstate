<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { StatusChip, unlockMethodTypeMap } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    unlockMethodId: string
  }
}>()

definePageMeta({
  name: "settings.unlock-method-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const unlockMethod = await settingsStore.getUnlockMethodDetails(params.unlockMethodId)

if (!unlockMethod) {
  throw createError({
    statusCode: 404,
    statusMessage: "Unlock Method not found",
  })
}

const detailItems = [
  { key: "unlockMethodId", label: "Unlock Method ID" },
  { key: "type", label: "Type" },
  { key: "createdAt", label: "Created" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="unlockMethod.meta"
      fallback-icon="mdi-lock-outline"
      :title="unlockMethod.meta.title || `${unlockMethod.type} Unlock Method`"
      :description="unlockMethod.meta.description"
    />

    <DetailInfoCard title="Unlock Method Details" :items="detailItems">
      <template #item.unlockMethodId>
        <IdTableCell :value="unlockMethod.id" />
      </template>

      <template #item.type>
        <StatusChip :status="unlockMethod.type" :status-map="unlockMethodTypeMap" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="unlockMethod.createdAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>