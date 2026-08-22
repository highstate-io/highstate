<script setup lang="ts">
import { PageContent } from "#layers/core/app/features/page-dialog"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "unit-page",
  panelId: route => `projects/${route.params.projectId}/pages/${route.params.pageId}`,
  panel: async route => {
    const { $client } = useNuxtApp()
    const page = await $client.state.getPage.query({
      projectId: route.params.projectId as string,
      pageId: route.params.pageId as string,
    })

    return {
      title: page?.meta.title ?? "Page",
      customIcon: page?.meta.icon,
      icon: "mdi-file-document",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    pageId: string
  }
}>()

const { state: page } = useAsyncState(async () => {
  const { $client } = useNuxtApp()
  return await $client.state.getPage.query({
    projectId: params.projectId,
    pageId: params.pageId,
  })
}, null)

ensureProjectStoresCreated(params.projectId)
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <div v-if="page" class="page-container">
      <PageContent :content="page.content" />
    </div>
    <VProgressCircular v-else indeterminate />
  </ProjectContainer>
</template>

<style scoped>
.page-container {
  width: 100%;
  height: 100%;
  padding: 24px;
  overflow: auto;
}
</style>
