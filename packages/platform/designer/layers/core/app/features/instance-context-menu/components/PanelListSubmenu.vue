<script setup lang="ts">
import { ContextMenuItem } from "#layers/core/app/features/shared"

const { panelIds } = defineProps<{
  panelIds: string[]
}>()

const { projectStore, stateStore } = useProjectStores()
const workspaceStore = useWorkspaceStore()
const panels = ref<Awaited<ReturnType<typeof stateStore.getPanels>>>([])
const loading = ref(false)
const visible = defineModel<boolean>("visible")

watch(visible, async isVisible => {
  if (!isVisible) {
    return
  }

  loading.value = true
  try {
    panels.value = await stateStore.getPanels(panelIds)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <ContextMenuItem icon="mdi-view-dashboard-outline" title="Panels">
    <VMenu
      v-model="visible"
      :open-on-focus="false"
      open-on-hover
      :close-on-content-click="false"
      submenu
      activator="parent"
    >
      <VList density="compact" variant="text">
        <ContextMenuItem
          v-for="panel in panels"
          :key="panel.id"
          :title="panel.meta.title"
          :subtitle="panel.meta.description"
          :custom-icon="panel.meta.icon"
          icon="mdi-view-dashboard-outline"
          @click="workspaceStore.openPanel(projectStore.projectId, panel.id)"
        />
        <VListItem v-if="loading" title="Loading panels..." />
      </VList>
    </VMenu>

    <template #append>
      <VIcon icon="mdi-menu-right" size="x-small" />
    </template>
  </ContextMenuItem>
</template>
