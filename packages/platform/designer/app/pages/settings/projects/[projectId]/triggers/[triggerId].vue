<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    triggerId: string
  }
}>()

definePageMeta({
  name: "settings.trigger-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const trigger = await settingsStore.getTriggerDetails(params.triggerId)

if (!trigger) {
  throw createError({
    statusCode: 404,
    statusMessage: "Trigger not found",
  })
}

const detailItems = [
  { key: "triggerId", label: "Trigger ID" },
  { key: "name", label: "Name" },
  { key: "createdAt", label: "Created" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="trigger.meta"
      fallback-icon="mdi-lightning-bolt"
      :title="trigger.meta.title || trigger.name || 'Unnamed Trigger'"
      :description="trigger.meta.description"
    />

    <DetailInfoCard title="Trigger Details" :items="detailItems">
      <template #item.triggerId>
        <IdTableCell :value="trigger.id" />
      </template>

      <template #item.name>
        <div class="text-body-2">{{ trigger.name || "N/A" }}</div>
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="trigger.createdAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>