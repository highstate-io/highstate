<script setup lang="ts">
import type { OperationType, OperationOptions } from "@highstate/backend/shared"
import { getVisibleOperationOptions } from "#layers/core/app/features/instance-context-menu"

const options = defineModel<OperationOptions>("options", { default: {} })

const { operation, compositeTargetsOnly = false } = defineProps<{
  operation: OperationType
  compositeTargetsOnly?: boolean
}>()

type OptionConfig = {
  key: keyof OperationOptions
  label: string
  description: string
  warning?: string
  showForOperations?: OperationType[]
  defaultValue?: boolean
}

const visibleOptions = computed(() => {
  return getVisibleOperationOptions(operation, { compositeTargetsOnly })
})

const updateOption = (key: keyof OperationOptions, value: boolean | null) => {
  const resolvedValue = value ?? false

  if (key === "forceUpdateDependencies" && resolvedValue) {
    options.value.ignoreChangedDependencies = false
    options.value.ignoreDependencies = false
  }

  if (key === "ignoreChangedDependencies" && resolvedValue) {
    options.value.forceUpdateDependencies = false
    options.value.ignoreDependencies = false
  }

  if (key === "ignoreDependencies" && resolvedValue) {
    options.value.forceUpdateDependencies = false
    options.value.ignoreChangedDependencies = false
  }

  if (key === "onlyDestroyGhosts" && resolvedValue) {
    options.value.firstDestroyGhosts = false
    options.value.ignoreGhosts = false
  }

  if (key === "firstDestroyGhosts" && resolvedValue) {
    options.value.onlyDestroyGhosts = false
    options.value.ignoreGhosts = false
  }

  if (key === "ignoreGhosts" && resolvedValue) {
    options.value.onlyDestroyGhosts = false
    options.value.firstDestroyGhosts = false
  }

  options.value[key] = resolvedValue
}
</script>

<template>
  <div v-if="options">
    <template v-for="config in visibleOptions" :key="config.key">
      <VCheckbox
        :model-value="options[config.key]"
        @update:model-value="value => updateOption(config.key, value)"
        :class="config === visibleOptions[0] ? 'mt-2' : ''"
        :label="config.label"
        density="compact"
        hide-details
      />

      <div class="text-caption">
        {{ config.description }}
      </div>
    </template>
  </div>
</template>
