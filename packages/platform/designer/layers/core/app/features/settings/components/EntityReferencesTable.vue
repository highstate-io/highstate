<script setup lang="ts">
import {
  SettingsDataTable,
  ShowDetailsAction,
  getSettingsEntityDisplayFromMeta,
} from "#layers/core/app/features/settings"
import { ComponentIcon } from "#layers/core/app/features/shared"
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

const { libraryStore } = useProjectStores()

const entityKey = direction === "outgoing" ? "to" : "from"
const headers = [
  { key: entityKey, title: "Entity" },
  { key: "group", title: "Group" },
  { key: "actions", title: "Actions", align: "center" as const },
]

const getEntityId = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityId : item.fromEntityId
}

const getEntityType = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityType : item.fromEntityType
}

const getEntityMeta = (item: EntityReferenceOutput) => {
  return direction === "outgoing" ? item.toEntityMeta : item.fromEntityMeta
}

const getEntityDisplay = (item: EntityReferenceOutput) => {
  return getSettingsEntityDisplayFromMeta({
    entities: libraryStore.library.entities,
    entityType: getEntityType(item),
    meta: getEntityMeta(item),
  })
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

    <template #item.to="{ item }">
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

    <template #item.actions="{ item }">
      <ShowDetailsAction
        page-name="settings.entity-details"
        :page-params="{ projectId, entityId: getEntityId(item) }"
      />
    </template>
  </SettingsDataTable>
</template>
