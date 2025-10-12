<script setup lang="ts">
import { EntityRefChip } from "../index"

const { instancesStore, libraryStore, stateStore } = useProjectStores()

const { item } = defineProps<{
  item: {
    stateId: string
  }
}>()

const instance = computed(() => {
  // get the state first to get the instanceId
  const state = stateStore.stateIdToStateMap.get(item.stateId)
  if (!state) return null

  // get the instance using the instanceId
  return instancesStore.instances.get(state.instanceId)
})

const componentMeta = computed(() => {
  if (!instance.value) return null

  const component = libraryStore.library.components[instance.value.type]
  return component?.meta ?? null
})

const entityMeta = computed(() => {
  if (!instance.value) return null

  return {
    title: instance.value.name,
    icon: componentMeta.value?.icon,
    iconColor: componentMeta.value?.iconColor,
  }
})
</script>

<template>
  <EntityRefChip
    :id="item.stateId"
    :meta="entityMeta"
    fallback-icon="mdi-cube-outline"
    page-name="settings.instance-details"
    :page-params="{ stateId: item.stateId }"
  />
</template>
