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
  <div class="h-100">
    <ProjectContainer
      v-if="projectsStore.focusedProjectId"
      :key="projectsStore.focusedProjectId"
      :project-id="projectsStore.focusedProjectId"
    >
      <AccessBoundary
        panel
        :requirements="[{ permission: 'operation.list', projectId: projectsStore.focusedProjectId, collection: true }]"
      >
        <OperationList :project-id="projectsStore.focusedProjectId" />
      </AccessBoundary>
    </ProjectContainer>
    <div v-else class="mt-4 text-center text-uppercase text-disabled">No active project</div>
  </div>
</template>
