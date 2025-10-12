<script setup lang="ts">
import { CompositeInstanceWrapper } from "#layers/core/app/features/composite-instance"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "composite-instance",
  panelId: route => `projects/${route.params.projectId}/composites/${route.params.stateId}`,
  panel: route => {
    const { instancesStore, libraryStore, stateStore } = useExplicitProjectStores(
      route.params.projectId as string,
    )
    const state = stateStore.stateIdToStateMap.get(route.params.stateId as string)
    const instance = state ? instancesStore.instances.get(state.instanceId) : undefined
    const component = instance ? libraryStore.library.components[instance.type] : undefined

    const title =
      component && instance
        ? `${component.meta.title} | ${instance.name}`
        : (route.params.stateId as string)

    return {
      title,
      preferStoredTitle: !component,
      icon: "mdi-cube-outline",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    stateId: string
  }
}>()

const { instancesStore, stateStore } = ensureProjectStoresCreated(params.projectId)

// get the instance state and instance
const instanceState = computed(() => stateStore.stateIdToStateMap.get(params.stateId))
const instance = computed(() => {
  const state = instanceState.value
  return state ? instancesStore.instances.get(state.instanceId) : undefined
})

const isCompositeReady = computed(
  () =>
    instancesStore.initializationPhase === "ready" && stateStore.initializationPhase === "ready",
)

const hasCompositeInstance = computed(() => Boolean(instanceState.value && instance.value))
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <CompositeInstanceWrapper
      v-if="isCompositeReady && hasCompositeInstance"
      :key="instancesStore.evaluationVersion"
      :project-id="params.projectId"
      :state-id="params.stateId"
      :version="instancesStore.evaluationVersion"
    />
    <div v-else-if="isCompositeReady" class="d-flex justify-center align-center h-100">
      <div class="text-center">
        <h3>Instance state not found</h3>
        <p>No instance state found for state ID: {{ params.stateId }}</p>
      </div>
    </div>
    <div v-else class="d-flex justify-center align-center h-100">
      <VProgressCircular indeterminate color="dark" size="32" />
    </div>
  </ProjectContainer>
</template>
