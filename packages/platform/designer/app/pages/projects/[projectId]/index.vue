<script setup lang="ts">
import { ProjectCanvas } from "#layers/core/app/features/project"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "project",
  panelId: route => `projects/${route.params.projectId}`,
  panel: route => {
    const projectsStore = useProjectsStore()
    const project = projectsStore.getById(route.params.projectId as string)

    return {
      title: project?.meta.title ?? `Project: ${route.params.projectId}`,
      preferStoredTitle: !project,
      icon: "mdi-folder",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
  }
}>()

ensureProjectStoresCreated(params.projectId)
useCanvasStore.ensureCreated("project", params.projectId)
useProjectPanelStore.ensureCreated(params.projectId)
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <ProjectCanvas />
  </ProjectContainer>
</template>
