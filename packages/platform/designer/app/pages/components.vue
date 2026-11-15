<script setup lang="ts">
import { ComponentListWrapper } from "#layers/core/app/features/component-panel"
import { ProjectContainer } from "#layers/core/app/features/shared"

defineProps<{
  params: unknown
}>()

definePageMeta({
  name: "components",
  panel: {
    title: "Components",
    icon: "mdi-cube-outline",
    closable: false,
    focusable: false,

    position: {
      referencePanel: "home",
      direction: "right",
    },

    initialWidth: 400,
    minimumWidth: 400,
    maximumWidth: 400,
  },
})

const projectsStore = useProjectsStore()
</script>

<template>
  <div class="h-100">
    <Suspense v-if="projectsStore.focusedProjectId" :key="projectsStore.focusedProjectId">
      <ProjectContainer :project-id="projectsStore.focusedProjectId">
        <AccessBoundary
          panel
          :requirements="[{ permission: 'library.get', collection: true }, { permission: 'instance-model.get', projectId: projectsStore.focusedProjectId, collection: true }]"
        >
          <ComponentListWrapper :project-id="projectsStore.focusedProjectId" />
        </AccessBoundary>
      </ProjectContainer>
    </Suspense>
    <div v-else class="mt-4 text-center text-uppercase text-disabled">No active project</div>
  </div>
</template>
