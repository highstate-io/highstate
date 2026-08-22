<script setup lang="ts">
import type {
  CollectionQuery,
  CollectionQueryResult,
  PanelOutput,
} from "@highstate/backend/shared"
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import {
  InstanceRefChip,
  ServiceAccountRefChip,
  WorkerVersionRefChip,
} from "#layers/core/app/features/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<PanelOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")
const workspaceStore = useWorkspaceStore()

const headers = [
  { ...baseHeaders.name, sortable: false },
  { key: "status", title: "Status", sortable: false },
  { key: "instance", title: "Instance", sortable: false },
  { key: "serviceAccount", title: "Service Account", sortable: false },
  { key: "workerVersion", title: "Worker Version", sortable: false },
  baseHeaders.id,
  baseHeaders.createdAt,
  baseHeaders.actions,
]
</script>

<template>
  <SettingsDataTable
    v-model:search="search"
    v-model:sort-by="sortBy"
    v-model:page="page"
    v-model:items-per-page="itemsPerPage"
    :headers="headers"
    :data="data"
    :loading="loading"
    :hide-header="hideHeader"
    :height="height"
  >
    <template #item.status="{ item }">
      <VChip
        :color="item.online ? 'success' : undefined"
        :prepend-icon="item.online ? 'mdi-access-point' : 'mdi-access-point-off'"
        size="small"
        variant="tonal"
      >
        {{ item.online ? "Online" : "Offline" }}
      </VChip>
    </template>

    <template #item.instance="{ item }">
      <InstanceRefChip :item="{ stateId: item.stateId }" />
    </template>

    <template #item.serviceAccount="{ item }">
      <ServiceAccountRefChip
        :item="{
          serviceAccountId: item.serviceAccountId,
          serviceAccountMeta: item.serviceAccountMeta,
        }"
      />
    </template>

    <template #item.workerVersion="{ item }">
      <WorkerVersionRefChip :item="item" />
    </template>

    <template #item.actions="{ item }">
      <TableItemAction
        icon="mdi-open-in-new"
        tooltip="Open Panel"
        :disabled="!item.online"
        @click="workspaceStore.openPanel(projectId, item.id)"
      />
      <ShowDetailsAction
        page-name="settings.panel-details"
        :page-params="{ projectId, panelId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
