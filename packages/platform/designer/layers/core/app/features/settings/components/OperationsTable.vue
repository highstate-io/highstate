<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { StatusChip, operationStatusMap, operationTypeMap } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  OperationOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<OperationOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  { title: "Status", key: "status", sortable: false },
  baseHeaders.name,
  baseHeaders.id,
  { title: "Type", key: "type", sortable: false },
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
      <StatusChip :status="item.status" :status-map="operationStatusMap" />
    </template>

    <!-- Type Column -->
    <template #item.type="{ item }">
      <StatusChip :status="item.type" :status-map="operationTypeMap" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.operation-details"
        :page-params="{ projectId, operationId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
