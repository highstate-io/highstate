<script setup lang="ts">
import type { IDockviewHeaderActionsProps } from "dockview-vue"
import ProjectLockButton from "./ProjectLockButton.vue"

const { params } = defineProps<{
  params: IDockviewHeaderActionsProps
}>()

const workspaceStore = useWorkspaceStore()
const projectsStore = useProjectsStore()
const isMainGroup = ref(false)

nextTick(() => {
  isMainGroup.value = params.group.model.panels.some(panel => panel.id === "home")
})
</script>

<template>
  <div v-if="isMainGroup" class="d-flex align-center">
    <Suspense v-if="projectsStore.focusedProjectId">
      <ProjectLockButton
        :key="projectsStore.focusedProjectId"
        :project-id="projectsStore.focusedProjectId"
      />
    </Suspense>
    <VBtn
      variant="text"
      size="small"
      class="toolbar-button ma-1"
      @click="workspaceStore.resetLayout()"
    >
      <VIcon>mdi-window-restore</VIcon>
      <VTooltip activator="parent" location="bottom">Reset Layout</VTooltip>
    </VBtn>
  </div>
</template>

<style scoped>
.toolbar-button {
  min-width: 0;
}
</style>
