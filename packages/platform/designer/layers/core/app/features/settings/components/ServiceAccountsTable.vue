<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import type { CollectionQuery, CollectionQueryResult, ServiceAccountOutput } from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<ServiceAccountOutput>
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
    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.service-account-details"
        :page-params="{ projectId, serviceAccountId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>