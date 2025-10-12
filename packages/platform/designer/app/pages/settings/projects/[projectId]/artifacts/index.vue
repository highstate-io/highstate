<script setup lang="ts">
import { SettingsListPage, ArtifactsTable } from "#layers/core/app/features/settings"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

settingsStore.artifacts.load()

definePageMeta({
  name: "settings.artifacts",
  tab: {
    label: "Artifacts",
    icon: "mdi-package-variant",
    order: 15,
    subpages: ["settings.artifact-details"],
  },
})
</script>

<template>
  <SettingsListPage
    title="Artifacts"
    icon="mdi-package-variant"
    description="Manage the artifacts produced by units or other components in your project."
  >
    <template #default="{ height }">
      <ArtifactsTable
        v-model:search="settingsStore.artifacts.search"
        v-model:sort-by="settingsStore.artifacts.sortBy"
        v-model:page="settingsStore.artifacts.page"
        v-model:items-per-page="settingsStore.artifacts.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.artifacts.data"
        :loading="settingsStore.artifacts.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
