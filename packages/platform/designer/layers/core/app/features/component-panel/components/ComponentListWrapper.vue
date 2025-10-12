<script setup lang="ts">
import { ProjectContainer } from "#layers/core/app/features/shared"
import ComponentList from "./ComponentList.vue"

const { projectId } = defineProps<{
  projectId: string
}>()

const libraryStore = await useProjectLibraryStore.async(projectId)
</script>

<template>
  <ProjectContainer :project-id="projectId">
    <VProgressLinear
      v-if="libraryStore.loading || (libraryStore.initialized && libraryStore.library.isReloading)"
      :indeterminate="true"
      color="primary"
      height="4"
      absolute
      location="bottom"
    />

    <ComponentList :key="projectId" :project-id="projectId" />
  </ProjectContainer>
</template>
