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
import type { EntityUiMeta } from "#layers/core/app/features/entity-explorer"
import type {
  CollectionQuery,
  CollectionQueryResult,
  EntitySnapshotListItemOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader, height, fallbackIconMeta } = defineProps<{
  projectId: string
  data: CollectionQueryResult<EntitySnapshotListItemOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
  fallbackIconMeta?: EntityUiMeta
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const { libraryStore } = useProjectStores()

const getEntityDisplay = (item: EntitySnapshotListItemOutput) => {
  return getSettingsEntityDisplayFromMeta({
    entities: libraryStore.library.entities,
    entityType: item.entityType,
    meta: item.meta,
  })
}

const getEntityTitle = (item: EntitySnapshotListItemOutput) => {
  return getEntityDisplay(item).title
}

const getEntitySubtitle = (item: EntitySnapshotListItemOutput) => {
  return getEntityDisplay(item).subtitle || item.id
}

const getEntityIconMeta = (item: EntitySnapshotListItemOutput) => {
  const displayMeta = getEntityDisplay(item).metaForIcon
  if (displayMeta?.icon) {
    return displayMeta
  }

  if (!fallbackIconMeta?.icon) {
    return item.meta
  }

  return {
    ...item.meta,
    icon: fallbackIconMeta.icon,
    iconColor: item.meta.iconColor ?? fallbackIconMeta.iconColor,
  }
}

const headers = [
  baseHeaders.name,
  baseHeaders.id,
  { key: "operationId", title: "Operation ID" },
  { key: "stateId", title: "State ID" },
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
        <ComponentIcon :meta="getEntityIconMeta(item)" :size="24" />

        <div class="d-flex flex-column">
          <div class="text-body-2 font-weight-medium">{{ getEntityTitle(item) }}</div>
          <div class="text-caption text-medium-emphasis">
            {{ getEntitySubtitle(item) }}
          </div>
        </div>
      </div>
    </template>

    <template #item.id="{ item }">
      <IdTableCell :value="item.id" />
    </template>

    <template #item.operationId="{ item }">
      <IdTableCell :value="item.operationId" />
    </template>

    <template #item.stateId="{ item }">
      <IdTableCell :value="item.stateId" />
    </template>

    <template #item.createdAt="{ item }">
      <TimeTableCell :value="item.createdAt" />
    </template>

    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.entity-snapshot-details"
        :page-params="{ projectId, snapshotId: item.id }"
      />
    </template>
  </SettingsDataTable>
</template>
