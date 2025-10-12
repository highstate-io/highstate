<script setup lang="ts">
import { until, useProjectStores } from "#imports"
import {
  DetailPageLayout,
  DetailInfoCard,
  TimeTableCell,
  IdTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import { StatusChip, operationStatusMap } from "#layers/core/app/features/shared"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    operationId: string
  }
}>()

definePageMeta({
  name: "settings.operation-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const operation = await settingsStore.getOperationDetails(params.operationId)

if (!operation) {
  throw createError({
    statusCode: 404,
    statusMessage: "Operation not found",
  })
}

const detailItems = [
  { key: "operationId", label: "Operation ID" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "startedAt", label: "Started" },
  { key: "finishedAt", label: "Finished" },
]

const getOperationTypeIcon = (type: string) => {
  switch (type) {
    case "update":
      return "mdi-update"
    case "preview":
      return "mdi-eye"
    case "destroy":
      return "mdi-delete"
    case "recreate":
      return "mdi-refresh"
    case "refresh":
      return "mdi-refresh"
    default:
      return "mdi-cog"
  }
}

const getOperationTypeColor = (type: string) => {
  switch (type) {
    case "update":
      return "primary"
    case "preview":
      return "info"
    case "destroy":
      return "error"
    case "recreate":
      return "warning"
    case "refresh":
      return "success"
    default:
      return "grey"
  }
}
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="operation.meta"
      fallback-icon="mdi-cog"
      :title="operation.meta.title || `${operation.type} Operation`"
      :description="operation.meta.description"
    />

    <DetailInfoCard title="Operation Details" :items="detailItems">
      <template #item.operationId>
        <IdTableCell :value="operation.id" />
      </template>

      <template #item.type>
        <VChip
          :color="getOperationTypeColor(operation.type)"
          :prepend-icon="getOperationTypeIcon(operation.type)"
          variant="flat"
          size="small"
          class="text-capitalize"
        >
          {{ operation.type }}
        </VChip>
      </template>

      <template #item.status>
        <StatusChip :status="operation.status" :status-map="operationStatusMap" />
      </template>

      <template #item.startedAt>
        <TimeTableCell :value="operation.startedAt" />
      </template>

      <template #item.finishedAt>
        <TimeTableCell v-if="operation.finishedAt" :value="operation.finishedAt" />
        <div v-else class="text-caption text-medium-emphasis">Not finished</div>
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>