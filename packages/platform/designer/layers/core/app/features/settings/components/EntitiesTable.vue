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
  EntityOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<EntityOutput>
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
  { key: "type", title: "Type" },
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

    <template #item.createdAt="{ item }">
      <TimeTableCell v-if="item.createdAt" :value="item.createdAt" />
      <div v-else class="text-caption text-medium-emphasis">N/A</div>
    </template>

    <template #item.actions="{ item }">
      <ShowDetailsAction
        v-if="item.snapshotId"
        page-name="settings.entity-snapshot-details"
        :page-params="{ projectId, snapshotId: item.snapshotId }"
      />

      <ShowDetailsAction
        v-else
        page-name="settings.entity-details"
        :page-params="{ projectId, entityId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
