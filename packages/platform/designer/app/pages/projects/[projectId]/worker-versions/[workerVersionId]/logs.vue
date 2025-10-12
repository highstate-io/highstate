<script setup lang="ts">
import { WorkerVersionLogsPanel } from "#layers/core/app/features/logs"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "worker-version-logs",
  panelId: route =>
    `projects/${route.params.projectId}/worker-versions/${route.params.workerVersionId}/logs`,

  panel: async route => {
    return {
      title: `Logs: ${route.params.workerVersionId}`,
      icon: "mdi-console",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    workerVersionId: string
  }
}>()

ensureProjectStoresCreated(params.projectId)
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <WorkerVersionLogsPanel
      :project-id="params.projectId"
      :worker-version-id="params.workerVersionId"
    />
  </ProjectContainer>
</template>
