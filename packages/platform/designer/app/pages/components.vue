<script setup lang="ts">
import { ComponentListWrapper } from "#layers/core/app/features/component-panel"

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
  <Suspense v-if="projectsStore.focusedProjectId" :key="projectsStore.focusedProjectId">
    <ComponentListWrapper :project-id="projectsStore.focusedProjectId" />
  </Suspense>
  <div v-else class="mt-4 text-center text-uppercase text-disabled">No active project</div>
</template>
