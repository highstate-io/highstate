<script setup lang="ts">
import ProjectCanvasPanel from "#layers/core/app/features/project/components/ProjectCanvasPanel.vue"
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
</script>

<template>
  <div class="h-100">
    <ProjectContainer :project-id="params.projectId" can-unlock>
      <AccessBoundary
        panel
        :requirements="[{ permission: 'instance-model.get', projectId: params.projectId, collection: true }]"
      >
        <ProjectCanvasPanel :key="params.projectId" :project-id="params.projectId" />
      </AccessBoundary>
    </ProjectContainer>
  </div>
</template>
