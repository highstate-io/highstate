<script setup lang="ts">
import { OperationList } from "#layers/core/app/features/operation-panel"
import { ProjectContainer } from "#layers/core/app/features/shared"

defineProps<{
  params: unknown
}>()

definePageMeta({
  name: "operations",
  panel: {
    title: "Operations",
    icon: "mdi-cogs",
    closable: false,
    focusable: false,

    position: {
      referencePanel: "components",
      direction: "below",
    },
  },
})

const projectsStore = useProjectsStore()
</script>

<template>
  <AccessBoundary
    v-if="projectsStore.focusedProjectId"
    :requirements="[{ permission: 'operation.list', projectId: projectsStore.focusedProjectId, collection: true }]"
  >
    <ProjectContainer
      v-if="projectsStore.focusedProjectId"
      :key="projectsStore.focusedProjectId"
      :project-id="projectsStore.focusedProjectId"
    >
      <OperationList :project-id="projectsStore.focusedProjectId" />
    </ProjectContainer>
  </AccessBoundary>
  <div v-else class="mt-4 text-center text-uppercase text-disabled">No active project</div>
</template>
