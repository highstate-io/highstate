<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { OwnerRefChip } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  ApiKeyOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<ApiKeyOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()
defineEmits<{ delete: [apiKey: ApiKeyOutput]; rotate: [apiKey: ApiKeyOutput] }>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  baseHeaders.name,
  baseHeaders.id,
  { title: "Owner", key: "owner", sortable: false },
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
      <div class="d-flex justify-center ga-1">
        <ShowDetailsAction
          page-name="settings.api-key-details"
          :page-params="{ projectId, apiKeyId: item.id }"
        />
        <TableItemAction
          icon="mdi-refresh"
          tooltip="Rotate token"
          :disabled="item.managed"
          @click="$emit('rotate', item)"
        />
        <TableItemAction
          icon="mdi-delete-outline"
          tooltip="Delete API key"
          color="error"
          :disabled="item.managed"
          @click="$emit('delete', item)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>
