<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  SecretValueField,
  baseHeaders,
} from "#layers/core/app/features/settings"
import { OwnerRefChip } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  SecretOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<SecretOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  {
    ...baseHeaders.name,
    headerProps: {
      defaultPrimaryIcon: "mdi:key",
    },
  },
  baseHeaders.id,
  { key: "owner", title: "Owner" },
  baseHeaders.createdAt,
  { title: "Value", key: "value" },
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

    <!-- Value Column -->
    <template #item.value="{ item }">
      <SecretValueField :secret-id="item.id" :project-id="projectId" />
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.secret-details"
        :page-params="{ projectId, secretId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
