<script setup lang="ts">
import LibrarySettingsPage from "#layers/core/app/features/library/components/LibrarySettingsPage.vue"

const { projectStore } = useProjectStores()

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

definePageMeta({
  name: "settings.library",
  tab: { label: "Library", icon: "mdi-bookshelf", order: 0 },
})
</script>

<template>
  <LibrarySettingsPage :project-id="projectStore.projectId" />
</template>
