<script setup lang="ts" generic="T extends GenericEntity">
import { Icon } from "@iconify/vue"
import type {
  CollectionQueryResult,
  CollectionQuery,
  GenericEntity,
} from "@highstate/backend/shared"
import type { TableHeader } from "../business/useSettingsTable"
import IdTableCell from "./IdTableCell.vue"
import TimeTableCell from "./TimeTableCell.vue"

const { headers, data, loading, hideHeader, hideSearch, height } = defineProps<{
  headers: TableHeader[]
  data: CollectionQueryResult<T>
  loading?: boolean
  hideHeader?: boolean
  hideSearch?: boolean
  height?: string | number
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

interface DataTableItemProps {
  item: T
  index: number
  [key: string]: unknown
}

const slots = defineSlots<{
  [K in `item.${string}`]: (props: DataTableItemProps) => VNode
}>()
</script>

<template>
  <div class="settings-table-container">
    <!-- Search and Summary -->
    <div v-if="!hideHeader" class="table-header">
      <div class="d-flex align-center">
        <VIcon class="mr-2">mdi-format-list-bulleted</VIcon>
        <span class="text-subtitle-1 font-weight-medium">
          {{ data.total }} item{{ data.total === 1 ? "" : "s" }}
        </span>
      </div>

      <VTextField
        v-if="!hideSearch"
        v-model="search"
        prepend-inner-icon="mdi-magnify"
        placeholder="Search"
        variant="outlined"
        density="compact"
        clearable
        hide-details
        style="max-width: 300px"
      />
    </div>

    <div class="table-wrapper">
      <VDataTableServer
        :headers="headers"
        :items="data.items"
        :items-length="data.total"
        :loading="loading"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        v-model:sort-by="sortBy"
        item-value="id"
        class="data-table"
        fixed-header
        :height="height"
      >
        <!-- Name & Description Column -->
        <template #item.meta.title="{ item }">
          <div class="d-flex align-center">
            <Icon
              v-if="
                item.meta.icon ||
                headers.find(h => h.key === 'meta.title')?.headerProps?.defaultPrimaryIcon
              "
              :icon="
                item.meta.icon ||
                headers.find(h => h.key === 'meta.title')?.headerProps?.defaultPrimaryIcon!
              "
              :color="
                item.meta.iconColor ??
                (item.meta.icon
                  ? undefined
                  : headers.find(h => h.key === 'meta.title')?.headerProps?.defaultPrimaryIconColor)
              "
              width="24"
              class="mr-4"
            />
            <div class="d-flex flex-column">
              <div class="text-body-1 font-weight-medium">
                {{ item.meta.title || "Unnamed" }}
              </div>
              <div v-if="item.meta.description" class="text-caption text-medium-emphasis">
                {{ item.meta.description.split("\n")[0] }}
              </div>
            </div>
          </div>
        </template>

        <!-- ID Column -->
        <template #item.id="{ item }">
          <IdTableCell :value="item.id" />
        </template>

        <!-- Created At Column -->
        <template #item.createdAt="{ item }">
          <TimeTableCell v-if="item.createdAt" :value="item.createdAt" />
        </template>

        <!-- Custom slots for dynamic items -->
        <template v-for="(_, slotName) in slots" :key="slotName" #[slotName]="slotProps">
          <slot :name="slotName" v-bind="slotProps" />
        </template>

        <!-- No data -->
        <template #no-data>
          <div class="text-center py-4">
            <div class="text-h6 text-medium-emphasis">No data available</div>
          </div>
        </template>
      </VDataTableServer>
    </div>
  </div>
</template>

<style scoped>
.settings-table-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.table-wrapper {
  flex: 1;
  min-width: 0;
}
</style>
