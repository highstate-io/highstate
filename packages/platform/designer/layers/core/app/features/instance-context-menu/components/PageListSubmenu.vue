<script setup lang="ts">
import { ContextMenuItem } from "#layers/core/app/features/shared"

const { pageIds } = defineProps<{
  pageIds: string[]
}>()

const { projectStore, stateStore } = useProjectStores()
const workspaceStore = useWorkspaceStore()
const pages = ref<Awaited<ReturnType<typeof stateStore.getPages>>>({})
const loading = ref(false)
const visible = defineModel<boolean>("visible")

watch(visible, async isVisible => {
  if (!isVisible) {
    return
  }

  loading.value = true
  try {
    pages.value = await stateStore.getPages(pageIds)
  } finally {
    loading.value = false
  }
})

const openPage = async (pageId: string) => {
  await workspaceStore.openPage(projectStore.projectId, pageId)
}
</script>

<template>
  <ContextMenuItem icon="mdi-file-document" title="Pages">
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
          v-for="pageId in pageIds"
          :key="pageId"
          :title="pages[pageId]?.meta.title ?? pageId"
          :subtitle="pages[pageId]?.meta.description"
          :custom-icon="pages[pageId]?.meta.icon"
          :disabled="!pages[pageId]"
          icon="mdi-file-document"
          @click="openPage(pageId)"
        />
        <VListItem v-if="loading" title="Loading pages..." />
      </VList>
    </VMenu>

    <template #append>
      <VIcon icon="mdi-menu-right" size="x-small" />
    </template>
  </ContextMenuItem>
</template>
