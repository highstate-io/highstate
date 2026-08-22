<script setup lang="ts">
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "unit-panel",
  panelId: route => `projects/${route.params.projectId}/panels/${route.params.panelId}`,
  panel: async route => {
    const { $client } = useNuxtApp()
    const panels = await $client.state.getInstancePanels.query({
      projectId: route.params.projectId as string,
      panelIds: [route.params.panelId as string],
    })
    const panel = panels[0]

    return {
      title: panel?.meta.title ?? "Panel",
      customIcon: panel?.meta.icon,
      icon: "mdi-view-dashboard-outline",
      closable: true,
      preferStoredTitle: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    panelId: string
  }
}>()
const { $client } = useNuxtApp()
const launchUrl = ref<string>()
const errorMessage = ref<string>()
const { stateStore } = ensureProjectStoresCreated(params.projectId)
let launchRequestId = 0
let unsubscribeAvailability: (() => void) | undefined

const launchPanel = async (requestId: number) => {
  try {
    const launch = await $client.state.createPanelLaunch.mutate({
      projectId: params.projectId,
      panelId: params.panelId,
    })
    if (requestId === launchRequestId) {
      launchUrl.value = launch.url
    }
  } catch (error) {
    if (requestId === launchRequestId) {
      errorMessage.value = error instanceof Error ? error.message : "Failed to launch panel"
    }
  }
}

watch(
  () => stateStore.unlockState?.type,
  unlockState => {
    const requestId = ++launchRequestId
    unsubscribeAvailability?.()
    unsubscribeAvailability = undefined
    launchUrl.value = undefined
    errorMessage.value = undefined
    if (unlockState !== "unlocked") {
      return
    }

    const subscription = $client.state.watchPanelAvailability.subscribe(
      {
        projectId: params.projectId,
        panelId: params.panelId,
      },
      {
        onData({ online }) {
          if (requestId !== launchRequestId) {
            return
          }
          if (!online) {
            launchUrl.value = undefined
            errorMessage.value = "Panel is offline"
            return
          }

          errorMessage.value = undefined
          void launchPanel(requestId)
        },
        onError(error) {
          if (requestId === launchRequestId) {
            errorMessage.value = error.message
          }
        },
      },
    )
    unsubscribeAvailability = subscription.unsubscribe
  },
  { immediate: true },
)

onUnmounted(() => unsubscribeAvailability?.())
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <div class="panel-frame-container">
      <VAlert v-if="errorMessage" type="error" :text="errorMessage" />
      <VProgressCircular v-else-if="!launchUrl" indeterminate />
      <iframe v-else :src="launchUrl" class="panel-frame" title="Unit panel" />
    </div>
  </ProjectContainer>
</template>

<style scoped>
.panel-frame-container {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  overflow: hidden;
}

.panel-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}
</style>
