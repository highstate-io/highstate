<script setup lang="ts">
import { navigateTo, until, useProjectStores } from "#imports"

const { settingsStore } = useProjectStores()
const { projectStore } = useProjectStores()

const { params } = defineProps<{
  params: {
    projectId: string
    entityId: string
  }
}>()

definePageMeta({
  name: "settings.entity-details",
})

if (projectStore.initializing) {
  await until(() => projectStore.initialized).toBe(true)
  projectStore.addLibraryRoot()
} else {
  await projectStore.initialize1()
  await projectStore.initialize2()
}

const entity = await settingsStore.getEntityDetails(params.entityId)

if (!entity) {
  throw createError({
    statusCode: 404,
    statusMessage: "Entity not found",
  })
}

if (!entity.lastSnapshot?.id) {
  throw createError({
    statusCode: 404,
    statusMessage: "Entity snapshot not found",
  })
}

await navigateTo({
  name: "settings.entity-snapshot-details",
  params: {
    projectId: params.projectId,
    snapshotId: entity.lastSnapshot.id,
  },
})
</script>

<template>
  <div />
</template>
