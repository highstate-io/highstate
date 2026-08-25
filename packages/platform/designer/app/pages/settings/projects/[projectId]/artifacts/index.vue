<script setup lang="ts">
import { SettingsListPage, ArtifactsTable } from "#layers/core/app/features/settings"

const settingsStore = useProjectArtifactSettingsStore()
const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

settingsStore.items.load()

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
        v-model:search="settingsStore.items.search"
        v-model:sort-by="settingsStore.items.sortBy"
        v-model:page="settingsStore.items.page"
        v-model:items-per-page="settingsStore.items.itemsPerPage"
        :project-id="projectStore.projectId"
        :data="settingsStore.items.data"
        :loading="settingsStore.items.isLoading"
        :height="height"
      />
    </template>
  </SettingsListPage>
</template>
