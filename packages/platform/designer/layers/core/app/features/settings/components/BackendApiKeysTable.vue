<script setup lang="ts">
import type {
  BackendApiKeyOutput,
  CollectionQuery,
  CollectionQueryResult,
} from "@highstate/backend/shared"
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  baseHeaders,
} from "#layers/core/app/features/settings"

defineProps<{
  data: CollectionQueryResult<BackendApiKeyOutput>
  loading?: boolean
  height?: string | number
}>()
defineEmits<{ delete: [apiKey: BackendApiKeyOutput]; rotate: [apiKey: BackendApiKeyOutput] }>()
const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")
const headers = [
  baseHeaders.name,
  { title: "Service account", key: "serviceAccount", sortable: false },
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
    :height="height"
  >
    <template #item.serviceAccount="{ item }">{{ item.serviceAccountMeta.title }}</template>
    <template #item.actions="{ item }">
      <div class="d-flex justify-center ga-1">
        <ShowDetailsAction
          page-name="settings.backend-api-key-details"
          :page-params="{ apiKeyId: item.id }"
        />
        <TableItemAction icon="mdi-refresh" tooltip="Rotate token" @click="$emit('rotate', item)" />
        <TableItemAction
          icon="mdi-delete-outline"
          tooltip="Delete API key"
          color="error"
          @click="$emit('delete', item)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>
