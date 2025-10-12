<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  IdTableCell,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { StatusChip, workerVersionStatusMap } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  WorkerVersionOutput,
} from "@highstate/backend/shared"

const { projectId, workerId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  workerId: string
  data: CollectionQueryResult<WorkerVersionOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const emit = defineEmits<{
  viewLogs: [versionId: string]
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  { title: "Status", key: "status", sortable: false },
  baseHeaders.name,
  baseHeaders.id,
  { title: "Digest", key: "digest", sortable: false },
  { title: "Enabled", key: "enabled", sortable: false },
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
    <!-- Status Column -->
    <template #item.status="{ item }">
      <StatusChip :status="item.status" :status-map="workerVersionStatusMap" />
    </template>

    <!-- Digest Column -->
    <template #item.digest="{ item }">
      <IdTableCell :value="item.digest" :truncate="true" copy-full-text="Copy full digest" />
    </template>

    <!-- Enabled Column -->
    <template #item.enabled="{ item }">
      <VChip
        size="small"
        :color="item.enabled ? 'success' : 'secondary'"
        class="text-uppercase"
      >
        {{ item.enabled ? "Enabled" : "Disabled" }}
      </VChip>
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <div class="d-flex justify-end gap-1">
        <ShowDetailsAction
          page-name="settings.worker-version-details"
          :page-params="{
            projectId: projectId,
            workerId: workerId,
            versionId: item.id,
          }"
        />
        <TableItemAction
          icon="mdi-console"
          tooltip="View Logs"
          variant="text"
          size="small"
          @click="emit('viewLogs', item.id)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>