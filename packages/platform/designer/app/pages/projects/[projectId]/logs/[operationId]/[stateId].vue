<script setup lang="ts">
import { InstanceLogsPanel } from "#layers/core/app/features/logs"
import { ProjectContainer } from "#layers/core/app/features/shared"

definePageMeta({
  name: "instance-logs",
  panelId: route =>
    `projects/${route.params.projectId}/operations/${route.params.operationId}/instances/${route.params.stateId}/logs`,

  panel: async route => {
    const { instancesStore, stateStore } = useExplicitProjectStores(
      route.params.projectId as string,
    )
    const state = stateStore.stateIdToStateMap.get(route.params.stateId as string)
    const instance = state ? instancesStore.instances.get(state.instanceId) : undefined

    return {
      title: `Logs | ${instance?.name ?? route.params.stateId}`,
      icon: "mdi-console",
      closable: true,
    }
  },
})

const { params } = defineProps<{
  params: {
    projectId: string
    operationId: string
    stateId: string
  }
}>()

ensureProjectStoresCreated(params.projectId)
</script>

<template>
  <ProjectContainer :project-id="params.projectId" can-unlock>
    <InstanceLogsPanel :operation-id="params.operationId" :state-id="params.stateId" />
  </ProjectContainer>
</template>
