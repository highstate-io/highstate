<script setup lang="ts">
import InstanceStatusFieldItem from "./InstanceStatusFieldItem.vue"
import { Icon } from "@iconify/vue"
import { InlineCopyButton } from "#layers/core/app/features/shared"
import type { InstanceStatusField } from "@highstate/contract"

const { statusField } = defineProps<{
  statusField: InstanceStatusField
}>()

const contentString = computed(() => {
  if (Array.isArray(statusField.value)) {
    return statusField.value.join(", ")
  }

  return String(statusField.value)
})

const visibleValue = computed(() => {
  if (!Array.isArray(statusField.value)) {
    return String(statusField.value)
  }

  if (statusField.value.length === 0) {
    return "[]"
  }

  if (statusField.value.length === 1) {
    return statusField.value[0]
  }

  return `${statusField.value.length} items`
})

const hasExtraContent = computed(() => {
  if (!Array.isArray(statusField.value)) {
    return false
  }

  return statusField.value.length > 1
})
</script>

<template>
  <div class="d-flex flex-row">
    <div class="d-flex text-disabled text-start text-no-wrap text-secondary">
      <Icon
        v-if="statusField.meta.icon"
        :icon="statusField.meta.icon"
        :color="statusField.meta.iconColor"
        :width="16"
        class="mr-1"
      />
      {{ statusField.meta.title }}
    </div>

    <VMenu
      open-on-hover
      :close-on-content-click="false"
      location="end"
      :disabled="!hasExtraContent"
    >
      <template #activator="{ props }">
        <div
          v-bind="props"
          class="d-flex ml-auto text-truncate pl-4"
          :title="hasExtraContent ? '' : contentString"
        >
          <span class="text-truncate" :class="{ underline: hasExtraContent }">
            {{ visibleValue }}
          </span>
        </div>
      </template>

      <VList density="compact" variant="text">
        <InstanceStatusFieldItem
          v-for="(item, index) in statusField.value"
          :key="index"
          :item="item"
        />
      </VList>
    </VMenu>

    <InlineCopyButton :content="contentString" />
  </div>
</template>

<style scoped>
.underline {
  text-decoration: none;
  border-bottom: 1px dotted;
}
</style>
