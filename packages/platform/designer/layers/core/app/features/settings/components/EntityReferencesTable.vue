<script setup lang="ts">
import { SettingsDataTable, ShowDetailsAction } from "#layers/core/app/features/settings"
import type {
  CollectionQuery,
  CollectionQueryResult,
  EntityReferenceOutput,
} from "@highstate/backend/shared"

const { projectId, direction, data, loading, hideHeader, height } = defineProps<{
  projectId: string
  direction: "outgoing" | "incoming"
  data: CollectionQueryResult<EntityReferenceOutput>
  loading?: boolean
  hideHeader?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const entityKey = direction === "outgoing" ? "to" : "from"
const headers = [
  { key: "group", title: "Group" },
  { key: entityKey, title: "Entity" },
  { key: "actions", title: "Actions", align: "center" as const },
]

const getEntityId = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityId : item.fromEntityId
}

const getEntityTitle = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityMeta.title : item.fromEntityMeta.title
}

const getEntityType = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityType : item.fromEntityType
}
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
    <template #item.from="{ item }">
      <div class="d-flex flex-column">
        <div class="text-body-2 font-weight-medium">{{ getEntityTitle(item) }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ getEntityType(item) }}
        </div>
      </div>
    </template>

    <template #item.to="{ item }">
      <div class="d-flex flex-column">
        <div class="text-body-2 font-weight-medium">{{ getEntityTitle(item) }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ getEntityType(item) }}
        </div>
      </div>
    </template>

    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.entity-details"
        :page-params="{ projectId, entityId: getEntityId(item) }"
      />
    </template>
  </SettingsDataTable>
</template>
