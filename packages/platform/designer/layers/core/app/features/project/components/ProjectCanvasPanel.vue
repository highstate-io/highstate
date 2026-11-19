<script setup lang="ts">
import ProjectCanvas from "./ProjectCanvas.vue"

const { projectId } = defineProps<{ projectId: string }>()
ensureProjectStoresCreated(projectId)
useCanvasStore.ensureCreated("project", projectId)
useProjectPanelStore.ensureCreated(projectId)
</script>

<template>
  <ProjectCanvas />
</template>
