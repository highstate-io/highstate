<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { OwnerRefChip } from "#layers/core/app/features/shared"
import type { CollectionQuery, CollectionQueryResult, PageOutput } from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<PageOutput>
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
    <!-- Owner Column -->
    <template #item.owner="{ item }">
      <OwnerRefChip :item="item" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.page-details"
        :page-params="{ projectId, pageId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
