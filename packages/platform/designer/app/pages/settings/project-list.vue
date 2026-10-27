<script setup lang="ts">
import {
  baseHeaders,
  IdTableCell,
  SettingsDataTable,
  SettingsListPage,
  type TableHeader,
} from "#layers/core/app/features/settings"
import { IdTableCell } from "#layers/core/app/features/settings"
import type { ProjectOutput } from "@highstate/backend/shared"
import ProjectPlacementDialog from "#layers/core/app/features/settings/components/ProjectPlacementDialog.vue"

const projectsStore = useProjectsStore()
const router = useRouter()
const placementProject = shallowRef<ProjectOutput | null>(null)
const placementVisible = ref(false)

function editPlacement(project: ProjectOutput) {
  placementProject.value = project
  placementVisible.value = true
}

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
  { key: "containerRuntimeId", title: "Runtime" },
  { key: "pulumiStateBackendId", title: "State backend" },
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
          <VBtn variant="text" size="small" @click="editPlacement(item)">Placement</VBtn>
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
  <ProjectPlacementDialog v-model="placementVisible" :project="placementProject" />
</template>
