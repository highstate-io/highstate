<script setup lang="ts">
import {
  DetailInfoCard,
  DetailPageLayout,
  IdTableCell,
  TimeTableCell,
} from "#layers/core/app/features/settings"
import SettingsPageHeader from "#layers/core/app/features/settings/components/SettingsPageHeader.vue"
import {
  InstanceRefChip,
  ServiceAccountRefChip,
  WorkerVersionRefChip,
} from "#layers/core/app/features/shared"

const { projectStore } = useProjectStores()
const settingsStore = useProjectPanelSettingsStore()
const workspaceStore = useWorkspaceStore()
const { params } = defineProps<{
  params: { projectId: string; panelId: string }
}>()

definePageMeta({ name: "settings.panel-details" })

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const panel = await settingsStore.get(params.panelId)
if (!panel) {
  throw createError({ statusCode: 404, statusMessage: "Panel not found" })
}

const detailItems = [
  { key: "panelId", label: "Panel ID" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "instance", label: "Instance" },
  { key: "serviceAccount", label: "Service Account" },
  { key: "workerVersion", label: "Worker Version" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Last Updated" },
]
</script>

<template>
  <DetailPageLayout>
    <SettingsPageHeader
      :meta="panel.meta"
      fallback-icon="mdi-view-dashboard-outline"
      :title="panel.meta.title"
      :description="panel.meta.description"
    >
      <template #actions>
        <VBtn
          variant="outlined"
          prepend-icon="mdi-open-in-new"
          :disabled="!panel.online"
          @click="workspaceStore.openPanel(params.projectId, panel.id)"
        >
          Open Panel
        </VBtn>
      </template>
    </SettingsPageHeader>

    <DetailInfoCard title="Panel Details" :items="detailItems">
      <template #item.panelId>
        <IdTableCell :value="panel.id" />
      </template>
      <template #item.name>{{ panel.name }}</template>
      <template #item.status>
        <VChip
          :color="panel.online ? 'success' : undefined"
          :prepend-icon="panel.online ? 'mdi-access-point' : 'mdi-access-point-off'"
          size="small"
          variant="tonal"
        >
          {{ panel.online ? "Online" : "Offline" }}
        </VChip>
      </template>
      <template #item.instance>
        <InstanceRefChip :item="{ stateId: panel.stateId }" />
      </template>
      <template #item.serviceAccount>
        <ServiceAccountRefChip
          :item="{
            serviceAccountId: panel.serviceAccountId,
            serviceAccountMeta: panel.serviceAccountMeta,
          }"
        />
      </template>
      <template #item.workerVersion>
        <WorkerVersionRefChip :item="panel" />
      </template>
      <template #item.createdAt>
        <TimeTableCell :value="panel.createdAt" />
      </template>
      <template #item.updatedAt>
        <TimeTableCell :value="panel.updatedAt" />
      </template>
    </DetailInfoCard>
  </DetailPageLayout>
</template>
