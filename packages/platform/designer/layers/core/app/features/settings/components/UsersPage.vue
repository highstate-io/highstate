<script setup lang="ts">
import type { UserOutput } from "@highstate/backend/shared"
import { baseHeaders } from "../business/useSettingsTable"
import SettingsDataTable from "./SettingsDataTable.vue"
import SettingsListPage from "./SettingsListPage.vue"
import TableItemAction from "./TableItemAction.vue"

const { projectId } = defineProps<{ projectId?: string }>()
const { $client } = useNuxtApp()
const access = useAccess()
const router = useRouter()
const requirement = { permission: "user.list" as const, projectId }
const allowed = computed(() => access.status(requirement).allowed)
const items = useCollectionQuery<UserOutput>(query =>
  projectId
    ? $client.projectUserSettings.query.query({ projectId, query })
    : $client.backendUserSettings.query.query(query),
)
const { search, sortBy, page, itemsPerPage, data, isLoading } = items
const headers = [
  { ...baseHeaders.name, title: "User" },
  { title: "Email", key: "email" },
  { title: "Authentication", key: "type" },
  baseHeaders.id,
  baseHeaders.createdAt,
  baseHeaders.actions,
]
watch(
  allowed,
  value => {
    if (value) {
      void items.load()
    }
  },
  { immediate: true },
)
useUsersRevision(projectId, undefined, allowed, () => {
  items.reset()
  void items.load()
})
const openUser = async (userId: string) => {
  await router.push({
    name: projectId ? "settings.user-details" : "settings.backend-user-details",
    params: { projectId, userId },
  })
}
</script>

<template>
  <AccessBoundary panel :requirements="[requirement]">
    <SettingsListPage
      :title="projectId ? 'Users' : 'Backend Users'"
      icon="mdi-account-group"
      description="All known human identities. Select a user to manage direct role bindings in this realm."
    >
      <template #default="{ height }">
        <SettingsDataTable
          v-model:search="search"
          v-model:sort-by="sortBy"
          v-model:page="page"
          v-model:items-per-page="itemsPerPage"
          :headers="headers"
          :data="data"
          :loading="isLoading"
          :height="height"
        >
          <template #item.meta.title="{ item }">
            <div>{{ item.meta.title }}</div>
            <div v-if="item.meta.username" class="text-caption text-medium-emphasis">
              {{ item.meta.username }}
            </div>
          </template>
          <template #item.email="{ item }">{{ item.meta.email ?? '—' }}</template>
          <template #item.type="{ item }"
            >{{ item.type === 'oidc' ? 'OIDC' : item.type === 'oauth' ? 'OAuth' : 'Local' }}</template
          >
          <template #item.actions="{ item }">
            <TableItemAction
              icon="mdi-account-cog"
              tooltip="View user and manage roles"
              :access="{ permission: 'user.get', projectId }"
              @click="openUser(item.id)"
            />
          </template>
        </SettingsDataTable>
      </template>
    </SettingsListPage>
  </AccessBoundary>
</template>
