<script setup lang="ts">
import type { InstanceInput } from "@highstate/contract"
import type { EntityModel } from "@highstate/contract"

import EntityExplorerCodeEditor from "./EntityExplorerCodeEditor.vue"
import { type OutputReferencedEntitySnapshot } from "../business"
import ReferencedEntitiesPopup from "./ReferencedEntitiesPopup.vue"

const { projectId, stateId, output, outputSources, entities } = defineProps<{
  projectId?: string
  stateId?: string
  output: string
  outputSources?: InstanceInput[]
  entities: Record<string, EntityModel | undefined>
}>()

const { $client } = useNuxtApp()
const stateStore = projectId ? useProjectStateStore(projectId) : null

type OutputKey = {
  stateId: string
  output: string
}

const outputKeys = computed<OutputKey[]>(() => {
  if (!projectId || !stateStore) {
    return []
  }

  if (outputSources && outputSources.length > 0) {
    const keys: OutputKey[] = []

    for (const source of outputSources) {
      const sourceStateId = stateStore.instanceStates.get(source.instanceId)?.id
      if (!sourceStateId) {
        continue
      }

      keys.push({ stateId: sourceStateId, output: source.output })
    }

    const seen = new Set<string>()
    const unique: OutputKey[] = []

    for (const key of keys) {
      const id = `${key.stateId}:${key.output}`
      if (seen.has(id)) {
        continue
      }

      seen.add(id)
      unique.push(key)
    }

    return unique
  }

  if (!stateId) {
    return []
  }

  return [{ stateId, output }]
})

const canLoad = computed(() => outputKeys.value.length > 0)

const cacheKey = computed(() => {
  if (!canLoad.value) {
    return ""
  }

  return outputKeys.value
    .map(key => `${key.stateId}:${key.output}`)
    .sort()
    .join("|")
})

const load = async (): Promise<OutputReferencedEntitySnapshot[]> => {
  if (!canLoad.value) {
    return []
  }

  const results = await Promise.all(
    outputKeys.value.map(async key => {
      return await $client.state.getOutputReferencedEntities.query({
        projectId: projectId!,
        stateId: key.stateId,
        output: key.output,
      })
    }),
  )

  const merged: OutputReferencedEntitySnapshot[] = []
  const seen = new Set<string>()

  for (const list of results) {
    for (const snapshot of list) {
      if (seen.has(snapshot.snapshotId)) {
        continue
      }

      seen.add(snapshot.snapshotId)
      merged.push(snapshot)
    }
  }

  return merged
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
