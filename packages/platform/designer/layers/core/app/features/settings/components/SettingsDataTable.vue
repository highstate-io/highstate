<script setup lang="ts" generic="T extends GenericEntity">
import { Icon } from "@iconify/vue"
import type {
  CollectionQuery,
  CollectionQueryResult,
  GenericEntity,
} from "@highstate/backend/shared"
import type { ObservedCollectionQueryResult } from "../../../utils/collection-query"
import type { TableHeader } from "../business/useSettingsTable"
import IdTableCell from "./IdTableCell.vue"
import TimeTableCell from "./TimeTableCell.vue"

const { headers, data, loading, hideHeader, hideSearch, height } = defineProps<{
  headers: TableHeader[]
  data: CollectionQueryResult<T> & Partial<ObservedCollectionQueryResult<T>>
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

const slots =
  defineSlots<{
    [K in `item.${string}`]: (props: DataTableItemProps) => VNode
  }>()
</script>

<template>
  <div class="settings-table-container">
    <VAlert v-if="data.error" type="error" density="compact" class="mb-4">{{ data.error }}</VAlert>

    <!-- Search and Summary -->
    <div v-if="!hideHeader" class="table-header">
      <div class="d-flex align-center">
        <VIcon class="mr-2">mdi-format-list-bulleted</VIcon>
        <span class="text-subtitle-1 font-weight-medium">
          {{ data.total ?? data.items.length }}
          {{ data.hasMore ? "+" : "" }}
          item{{ (data.total ?? data.items.length) === 1 ? "" : "s" }}
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
        :items-length="data.items.length"
        :loading="loading"
        v-model:items-per-page="itemsPerPage"
        v-model:sort-by="sortBy"
        item-value="id"
        class="data-table"
        fixed-header
        :height="height"
        hide-default-footer
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
              <div class="text-body-1 font-weight-medium">{{ item.meta.title || "Unnamed" }}</div>
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

      <div class="table-footer">
        <VSelect
          v-model="itemsPerPage"
          :items="[10, 20, 50, 100]"
          label="Items per page"
          density="compact"
          variant="outlined"
          hide-details
          class="items-per-page"
        />
        <span class="text-body-2 text-medium-emphasis">Page {{ page }}</span>
        <VBtn
          icon="mdi-chevron-left"
          variant="text"
          size="small"
          aria-label="Previous page"
          :disabled="page <= 1 || loading"
          @click="page = Math.max(1, (page ?? 1) - 1)"
        />
        <VBtn
          icon="mdi-chevron-right"
          variant="text"
          size="small"
          aria-label="Next page"
          :disabled="loading || !data.hasNextPage"
          @click="page = (page ?? 1) + 1"
        />
      </div>
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

.table-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}

.items-per-page {
  max-width: 160px;
}
</style>
