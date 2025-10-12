<script setup lang="ts">
import {
  SettingsListPage,
  SettingsDataTable,
  baseHeaders,
  type TableHeader,
} from "#layers/core/app/features/settings"
import { IdTableCell } from "#layers/core/app/features/settings"

const projectsStore = useProjectsStore()
const router = useRouter()

definePageMeta({
  name: "settings.project-list",
  tab: {
    label: "Projects",
    icon: "mdi-folder-multiple",
    order: 2,
  },
})

const tableHeaders: TableHeader[] = [
  baseHeaders.name,
  baseHeaders.id,
  baseHeaders.createdAt,
  {
    key: "actions",
    title: "Actions",
  },
]

const search = ref("")
const lazySearch = debouncedRef(search, 300)

const sortBy = ref()
const page = ref(1)
const itemsPerPage = ref(10)

const data = computed(() => {
  const lowerSearch = lazySearch.value.toLowerCase().trim()

  const filteredProjects = lowerSearch
    ? projectsStore.projects.filter(
        project =>
          project.id.includes(lowerSearch) ||
          project.meta.title.toLowerCase().includes(lowerSearch) ||
          project.meta.description?.toLowerCase().includes(lowerSearch),
      )
    : projectsStore.projects

  return {
    items: filteredProjects,
    total: filteredProjects.length,
  }
})

const navigateToProject = (projectId: string) => {
  router.push({
    name: "project",
    params: { projectId },
  })
}
</script>

<template>
  <SettingsListPage
    title="Projects"
    icon="mdi-folder-multiple"
    description="Manage your projects and their associated instances, secrets, and settings. Projects encapsulate all configurations and data for your application."
  >
    <template #default="{ height }">
      <SettingsDataTable
        v-model:search="search"
        v-model:sort-by="sortBy"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="tableHeaders"
        :data="data"
        :loading="false"
        :height="height"
      >
        <!-- Actions Column -->
        <template #item.actions="{ item }">
          <VBtn
            icon="mdi-arrow-right"
            variant="text"
            size="small"
            @click="navigateToProject(item.id)"
          />
        </template>
      </SettingsDataTable>
    </template>
  </SettingsListPage>
</template>
