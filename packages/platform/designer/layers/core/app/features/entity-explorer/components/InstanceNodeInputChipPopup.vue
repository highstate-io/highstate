<script setup lang="ts">
import type { ResolvedInstanceInput } from "@highstate/backend/shared"
import type { EntityModel } from "@highstate/contract"

import EntityExplorerCodeEditor from "./EntityExplorerCodeEditor.vue"
import ReferencedEntitiesPopup from "./ReferencedEntitiesPopup.vue"
import type { OutputReferencedEntitySnapshot } from "../business"

type OutputKey = {
  stateId: string
  output: string
}

const { projectId, resolvedInputs, entities } = defineProps<{
  projectId: string
  resolvedInputs: ResolvedInstanceInput[]
  entities: Record<string, EntityModel | undefined>
}>()

const { $client } = useNuxtApp()
const stateStore = useProjectStateStore(projectId)

const allowedEntityTypes = computed(() => {
  return new Set(resolvedInputs.map(input => input.type).filter(Boolean))
})

const outputKeys = computed<OutputKey[]>(() => {
  const keys: OutputKey[] = []

  for (const resolved of resolvedInputs) {
    const instanceId = resolved.input.instanceId
    const output = resolved.input.output

    const stateId = stateStore.instanceStates.get(instanceId)?.id
    if (!stateId) {
      continue
    }

    keys.push({ stateId, output })
  }

  const seen = new Set<string>()
  const unique: OutputKey[] = []
  for (const key of keys) {
    const id = `${key.stateId}:${key.output}`
    if (seen.has(id)) continue

    seen.add(id)
    unique.push(key)
  }

  return unique
})

const canLoad = computed(() => outputKeys.value.length > 0)

const cacheKey = computed(() => {
  if (!canLoad.value) {
    return ""
  }

  const outputsKey = outputKeys.value
    .map(key => `${key.stateId}:${key.output}`)
    .sort()
    .join("|")
  const typesKey = Array.from(allowedEntityTypes.value).sort().join(",")
  return `${outputsKey}#${typesKey}`
})

const load = async (): Promise<OutputReferencedEntitySnapshot[]> => {
  if (!canLoad.value) {
    return []
  }

  const results = await Promise.all(
    outputKeys.value.map(async key => {
      return await $client.state.getOutputReferencedEntities.query({
        projectId,
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

  if (allowedEntityTypes.value.size === 0) {
    return []
  }

  return merged.filter(snapshot => allowedEntityTypes.value.has(snapshot.entityType))
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
