<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { StatusChip, unlockMethodTypeMap } from "#layers/core/app/features/shared"
import type { CollectionQuery, CollectionQueryResult, UnlockMethodOutput } from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<UnlockMethodOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const emit = defineEmits<{
  delete: [item: UnlockMethodOutput]
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  { key: "type", title: "Type" },
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
    <!-- Type Column -->
    <template #item.type="{ item }">
      <StatusChip :status="item.type" :status-map="unlockMethodTypeMap" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <div class="d-flex align-center gap-1">
        <ShowDetailsAction
          page-name="settings.unlock-method-details"
          :page-params="{ projectId, unlockMethodId: item.id }"
        />
        <VBtn
          variant="text"
          icon="mdi-delete"
          size="small"
          color="error"
          @click="emit('delete', item)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>