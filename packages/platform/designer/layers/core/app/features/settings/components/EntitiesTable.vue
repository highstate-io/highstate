<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  IdTableCell,
  TimeTableCell,
  baseHeaders,
  getSettingsEntityDisplayFromMeta,
} from "#layers/core/app/features/settings"
import { ComponentIcon } from "#layers/core/app/features/shared"
import type {
  CollectionQuery,
  CollectionQueryResult,
  EntityOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  data: CollectionQueryResult<EntityOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const { libraryStore } = useProjectStores()

const getEntityDisplay = (item: EntityOutput) => {
  return getSettingsEntityDisplayFromMeta({
    entities: libraryStore.library.entities,
    entityType: item.type,
    meta: item.meta,
  })
}

const headers = [
  baseHeaders.name,
  baseHeaders.id,
  { key: "type", title: "Type" },
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
    <template #item.meta.title="{ item }">
      <div class="d-flex align-center ga-3">
        <ComponentIcon
          v-if="getEntityDisplay(item).metaForIcon"
          :meta="getEntityDisplay(item).metaForIcon!"
          :size="24"
        />

        <div class="d-flex flex-column">
          <div class="text-body-2 font-weight-medium">{{ getEntityDisplay(item).title }}</div>
          <div v-if="getEntityDisplay(item).subtitle" class="text-caption text-medium-emphasis">
            {{ getEntityDisplay(item).subtitle }}
          </div>
        </div>
      </div>
    </template>

    <template #item.id="{ item }">
      <IdTableCell :value="item.id" />
    </template>

    <template #item.createdAt="{ item }">
      <TimeTableCell v-if="item.createdAt" :value="item.createdAt" />
      <div v-else class="text-caption text-medium-emphasis">N/A</div>
    </template>

    <template #item.actions="{ item }">
      <ShowDetailsAction
        v-if="item.snapshotId"
        page-name="settings.entity-snapshot-details"
        :page-params="{ projectId, snapshotId: item.snapshotId }"
      />

      <ShowDetailsAction
        v-else
        page-name="settings.entity-details"
        :page-params="{ projectId, entityId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
