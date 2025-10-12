<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
  SecretValueField,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { OwnerRefChip } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    secretId: string
  }
}>()

definePageMeta({
  name: "settings.secret-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const secret = await settingsStore.getSecretDetails(params.secretId)

if (!secret) {
  throw createError({
    statusCode: 404,
    statusMessage: "Secret not found",
  })
}

const detailItems = [
  { key: "secretId", label: "Secret ID" },
  { key: "name", label: "Name" },
  { key: "value", label: "Value" },
  { key: "owner", label: "Owner" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="secret.meta"
      fallback-icon="mdi-key-variant"
      :title="secret.meta.title || secret.name || 'Unnamed Secret'"
      :description="secret.meta.description"
    />

    <DetailInfoCard title="Secret Details" :items="detailItems">
      <template #item.secretId>
        <IdTableCell :value="secret.id" />
      </template>

      <template #item.name>
        <div class="text-body-2">{{ secret.name || "N/A" }}</div>
      </template>

      <template #item.value>
        <SecretValueField :secret-id="secret.id" :project-id="params.projectId" />
      </template>

      <template #item.owner>
        <OwnerRefChip :item="secret" />
      </template>

      <template #item.createdAt>
        <TimeTableCell :value="secret.createdAt" />
      </template>

      <template #item.updatedAt>
        <TimeTableCell :value="secret.updatedAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>