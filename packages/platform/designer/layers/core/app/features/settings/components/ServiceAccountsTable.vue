<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import type {
  CollectionQuery,
  CollectionQueryResult,
  ServiceAccountOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<ServiceAccountOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()
defineEmits<{ delete: [serviceAccount: ServiceAccountOutput] }>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [baseHeaders.name, baseHeaders.id, baseHeaders.createdAt, baseHeaders.actions]
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
      <div class="d-flex justify-center ga-1">
        <ShowDetailsAction
          page-name="settings.service-account-details"
          :page-params="{ projectId, serviceAccountId: item.id }"
        />
        <TableItemAction
          icon="mdi-delete-outline"
          tooltip="Delete service account"
          color="error"
          :disabled="!!item.systemName"
          @click="$emit('delete', item)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>
