<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  IdTableCell,
  TimeTableCell,
  baseHeaders,
} from "#layers/core/app/features/settings"
import type {
  CollectionQuery,
  CollectionQueryResult,
  EntitySnapshotListItemOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<EntitySnapshotListItemOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  baseHeaders.id,
  { key: "operationId", title: "Operation ID" },
  { key: "stateId", title: "State ID" },
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
    <template #item.id="{ item }">
      <IdTableCell :value="item.id" />
    </template>

    <template #item.operationId="{ item }">
      <IdTableCell :value="item.operationId" />
    </template>

    <template #item.stateId="{ item }">
      <IdTableCell :value="item.stateId" />
    </template>

    <template #item.createdAt="{ item }">
      <TimeTableCell :value="item.createdAt" />
    </template>

    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.entity-snapshot-details"
        :page-params="{ projectId, snapshotId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
