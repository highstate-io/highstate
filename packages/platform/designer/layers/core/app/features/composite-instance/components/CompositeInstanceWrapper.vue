<script setup lang="ts">
import CompositeInstanceCanvas from "./CompositeInstanceCanvas.vue"

const { projectId, stateId, version } = defineProps<{
  projectId: string
  stateId: string
  version: number
}>()

useCanvasStore.ensureCreated("instance", projectId, stateId, version)
useCompositeStore.ensureCreated(projectId, stateId, version)
</script>

<template>
  <CompositeInstanceCanvas :project-id="projectId" :state-id="stateId" :version="version" />
</template>
