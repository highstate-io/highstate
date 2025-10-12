<script setup lang="ts">
import {
  SettingsDataTable,
  IdTableCell,
  TimeTableCell,
  baseHeaders,
} from "#layers/core/app/features/settings"
import type {
  CollectionQuery,
  CollectionQueryResult,
  TerminalSessionOutput,
} from "@highstate/backend/shared"

const { projectId, data, loading, hideHeader } = defineProps<{
  projectId: string
  data: CollectionQueryResult<TerminalSessionOutput>
  loading?: boolean
  hideHeader?: boolean
}>()

const emit = defineEmits<{
  openSession: [sessionId: string]
}>()

const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")

const headers = [
  baseHeaders.id,
  { title: "Started", key: "startedAt" },
  { title: "Finished", key: "finishedAt" },
  { title: "Duration", key: "duration" },
  baseHeaders.actions,
]

// Helper functions
const formatDuration = (startedAt: string | Date, finishedAt: string | Date | null) => {
  const start = new Date(startedAt)
  const end = finishedAt ? new Date(finishedAt) : new Date()
  const duration = end.getTime() - start.getTime()

  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
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
  >
    <!-- Started Column -->
    <template #item.startedAt="{ item }">
      <TimeTableCell :value="item.startedAt" />
    </template>

    <!-- Finished Column -->
    <template #item.finishedAt="{ item }">
      <TimeTableCell v-if="item.finishedAt" :value="item.finishedAt" />
      <VChip v-else size="small" color="success" variant="outlined">Running</VChip>
    </template>

    <!-- Duration Column -->
    <template #item.duration="{ item }">
      <div class="text-body-2">
        {{ formatDuration(item.startedAt, item.finishedAt) }}
      </div>
    </template>

    <!-- Actions Column -->
    <template #item.actions="{ item }">
      <VBtn
        variant="text"
        icon="mdi-open-in-new"
        size="small"
        @click="emit('openSession', item.id)"
      />
    </template>
  </SettingsDataTable>
</template>