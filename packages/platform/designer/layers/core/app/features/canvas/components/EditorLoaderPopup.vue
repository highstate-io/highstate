<script setup lang="ts">
import EditorLoader from "./EditorLoader.vue"

const { instancesStore, stateStore } = useProjectStores()

const visible = computed(() => {
  return (
    instancesStore.initializationPhase === "resolving" ||
    stateStore.initializationPhase === "calculating"
  )
})
</script>

<template>
  <VCard v-if="visible" variant="tonal">
    <EditorLoader
      v-if="instancesStore.initializationPhase === 'resolving'"
      text="Resolving instance inputs"
      :value="instancesStore.resolvedInstanceCount"
    />

    <EditorLoader
      v-if="stateStore.initializationPhase === 'calculating'"
      text="Detecting instance changes"
      :value="stateStore.calculatedInputHashCount"
    />
  </VCard>
</template>
