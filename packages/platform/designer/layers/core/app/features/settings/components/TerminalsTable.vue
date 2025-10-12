<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { StatusChip, OwnerRefChip, terminalStatusMap } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  TerminalOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<TerminalOutput>
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
  { key: "owner", title: "Owner", sortable: false },
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
    <!-- Status Column -->
    <template #item.status="{ item }">
      <StatusChip :status="item.status" :status-map="terminalStatusMap" />
    </template>

    <!-- Owner Column -->
    <template #item.owner="{ item }">
      <OwnerRefChip :item="item" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.terminal-details"
        :page-params="{ projectId, terminalId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
