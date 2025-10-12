<script setup lang="ts">
import ProjectContainer from "./ProjectContainer.vue"

const { projectId } = defineProps<{
  projectId: string
}>()

ensureProjectStoresCreated(projectId)
</script>

<template>
  <div class="tab-wrapper">
    <ProjectContainer :project-id="projectId" can-unlock>
      <slot />
    </ProjectContainer>
  </div>
</template>

<style scoped>
.tab-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
</style>
