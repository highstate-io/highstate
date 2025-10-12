<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  IdTableCell,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { OwnerRefChip } from "#layers/core/app/features/shared"
import type { CollectionQuery, CollectionQueryResult, WorkerOutput } from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<WorkerOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  baseHeaders.name,
  baseHeaders.id,
  { key: "identity", title: "Identity" },
  { key: "owner", title: "Owner" },
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
    <!-- Identity Column -->
    <template #item.identity="{ item }">
      <IdTableCell :value="item.identity" :truncate="false" copy-full-text="Copy full identity" />
    </template>

    <!-- Owner Column -->
    <template #item.owner="{ item }">
      <OwnerRefChip :item="item" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.worker-details"
        :page-params="{ projectId, workerId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>