<script setup lang="ts">
import { parseVersionedName, type ComponentModel } from "@highstate/contract"
import { ComponentCard, setComponentDragData } from "#layers/core/app/features/shared"

const { components } = defineProps<{
  components: ComponentModel[]
}>()

const selectedComponentType = ref(components[0]!.type)

const selectedComponent = computed(() => {
  return (
    components.find(component => component.type === selectedComponentType.value) ?? components[0]!
  )
})

const versions = computed(() => {
  return components.map(component => {
    try {
      const [, version] = parseVersionedName(component.type)

      return {
        title: `v${version}`,
        value: component.type,
      }
    } catch {
      return {
        title: component.type,
        value: component.type,
      }
    }
  })
})

const onDragStart = (event: DragEvent) => {
  setComponentDragData(event.dataTransfer!, selectedComponent.value.type)
}

const isExperimental = computed(() => {
  try {
    const [, version] = parseVersionedName(selectedComponent.value.type)
    return version === 0
  } catch {
    return false
  }
})

const unstableTooltip =
  "Components with version v0 are unstable and may be broken or disappear without warning."
</script>

<template>
  <div draggable="true" style="cursor: grab" @dragstart="onDragStart">
    <ComponentCard
      :component="selectedComponent"
      :text="selectedComponent.meta.description?.split('\n')[0]"
    >
      <template #append>
        <div class="d-flex align-center ga-2">
          <VSelect
            v-if="versions.length > 1"
            v-model="selectedComponentType"
            :items="versions"
            class="version-selector"
            density="compact"
            hide-details
            variant="outlined"
            @pointerdown.stop
            @mousedown.stop
            @click.stop
          />

          <VTooltip v-if="isExperimental" location="top">
            <template #activator="{ props }">
              <VChip v-bind="props" color="warning" label size="small" variant="flat">
                unstable
              </VChip>
            </template>
            <span>{{ unstableTooltip }}</span>
          </VTooltip>
        </div>
      </template>
    </ComponentCard>
  </div>
</template>

<style scoped>
.version-selector {
  width: 88px;
}
</style>
