<script setup lang="ts">
import type {
  CollectionQuery,
  CollectionQueryResult,
  ProjectRoleOutput,
} from "@highstate/backend/shared"
import {
  SettingsDataTable,
  ShowDetailsAction,
  TableItemAction,
  baseHeaders,
} from "#layers/core/app/features/settings"
const { projectId } = defineProps<{
  projectId: string
  data: CollectionQueryResult<ProjectRoleOutput>
  loading?: boolean
  height?: string | number
}>()
defineEmits<{ delete: [role: ProjectRoleOutput] }>()
const search = defineModel<string>("search")
const sortBy = defineModel<CollectionQuery["sortBy"]>("sortBy")
const page = defineModel<number>("page")
const itemsPerPage = defineModel<number>("itemsPerPage")
const headers = [baseHeaders.name, baseHeaders.createdAt, baseHeaders.actions]
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
    :height="height"
  >
    <template #item.actions="{ item }">
      <div class="d-flex justify-center ga-1">
        <ShowDetailsAction
          page-name="settings.project-role-details"
          :page-params="{ projectId, roleId: item.id }"
        />
        <TableItemAction
          icon="mdi-delete-outline"
          tooltip="Delete role"
          color="error"
          :disabled="!!item.systemName"
          @click="$emit('delete', item)"
        />
      </div>
    </template>
  </SettingsDataTable>
</template>
