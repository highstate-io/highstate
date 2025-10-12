<script setup lang="ts">
import type { IDockviewHeaderActionsProps } from "dockview-vue"

const { params } = defineProps<{
  params: IDockviewHeaderActionsProps
}>()

const workspaceStore = useWorkspaceStore()
const isMainGroup = ref(false)

nextTick(() => {
  isMainGroup.value = params.group.model.panels.some(panel => panel.id === "home")
})
</script>

<template>
  <VBtn
    v-if="isMainGroup"
    variant="text"
    size="small"
    class="toolbar-button ma-1"
    @click="workspaceStore.resetLayout()"
  >
    <VIcon>mdi-window-restore</VIcon>
    <VTooltip activator="parent" location="bottom">Reset Layout</VTooltip>
  </VBtn>
</template>

<style scoped>
.toolbar-button {
  min-width: 0;
}
</style>
