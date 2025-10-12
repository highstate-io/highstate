<script setup lang="ts">
import { parseVersionedName, type ComponentModel } from "@highstate/contract"
import { ComponentCard, setComponentDragData } from "#layers/core/app/features/shared"

const { component } = defineProps<{
  component: ComponentModel
}>()

const onDragStart = (event: DragEvent) => {
  setComponentDragData(event.dataTransfer!, component.type)
}

const isExperimental = computed(() => {
  try {
    const [, version] = parseVersionedName(component.type)
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
    <ComponentCard :component="component" :text="component.meta.description?.split('\n')[0]">
      <template #append>
        <VTooltip v-if="isExperimental" location="top">
          <template #activator="{ props }">
            <VChip v-bind="props" color="warning" label size="small" variant="flat">unstable</VChip>
          </template>
          <span>{{ unstableTooltip }}</span>
        </VTooltip>
      </template>
    </ComponentCard>
  </div>
</template>
