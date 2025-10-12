<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  IdTableCell,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { bytesToHumanReadable } from "@highstate/contract"
import type { CollectionQuery, CollectionQueryResult, ArtifactOutput } from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<ArtifactOutput>
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
  { key: "hash", title: "Hash" },
  { key: "size", title: "Size" },
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
    <!-- Hash Column -->
    <template #item.hash="{ item }">
      <IdTableCell :value="item.hash" copy-full-text="Copy full hash" />
    </template>

    <!-- Size Column -->
    <template #item.size="{ item }">
      {{ bytesToHumanReadable(item.size) }}
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.artifact-details"
        :page-params="{ projectId, artifactId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>