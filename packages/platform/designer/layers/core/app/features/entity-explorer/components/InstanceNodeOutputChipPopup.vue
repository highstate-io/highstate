<script setup lang="ts">
import type { EntityModel } from "@highstate/contract"

import EntityExplorerCodeEditor from "./EntityExplorerCodeEditor.vue"
import { type OutputReferencedEntitySnapshot } from "../business"
import ReferencedEntitiesPopup from "./ReferencedEntitiesPopup.vue"

const { projectId, stateId, output, entities } = defineProps<{
  projectId?: string
  stateId?: string
  output: string
  entities: Record<string, EntityModel | undefined>
}>()

const { $client } = useNuxtApp()

const canLoad = computed(() => Boolean(projectId && stateId))

const cacheKey = computed(() => {
  if (!canLoad.value) {
    return ""
  }

  return `${stateId}:${output}`
})

const load = async (): Promise<OutputReferencedEntitySnapshot[]> => {
  if (!canLoad.value) {
    return []
  }

  return await $client.state.getOutputReferencedEntities.query({
    projectId: projectId!,
    stateId: stateId!,
    output,
  })
}
</script>

<template>
  <ReferencedEntitiesPopup
    :can-load="canLoad"
    :cache-key="cacheKey"
    :entities="entities"
    :load="load"
  >
    <template #activator="slotProps">
      <slot name="activator" v-bind="slotProps" />
    </template>

    <template #content="{ entity }">
      <EntityExplorerCodeEditor :entity="entity" :project-id="projectId" />
    </template>
  </ReferencedEntitiesPopup>
</template>
