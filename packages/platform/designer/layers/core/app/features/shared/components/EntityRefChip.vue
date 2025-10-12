<script setup lang="ts">
import type { RouteParamsRaw, RouteRecordName } from "vue-router"
import type { ObjectMeta } from "@highstate/contract"
import { GenericIcon } from "../index"

const { id, meta, fallbackIcon, pageName, pageParams, color, maxLength = 20 } = defineProps<{
  id: string
  fallbackIcon?: string
  pageName: string
  pageParams: Record<string, string>
  meta?: ObjectMeta | null
  color?: string
  maxLength?: number
}>()

const handleClick = () => {
  navigateTo({
    name: pageName as RouteRecordName,
    params: pageParams as RouteParamsRaw,
  })
}

const displayText = computed(() => {
  const text = meta?.title ?? id
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
})
</script>

<template>
  <VChip
    :color="meta?.color ?? color"
    class="font-weight-bold cursor-pointer"
    size="small"
    @click="handleClick"
  >
    <template #prepend>
      <GenericIcon
        v-if="meta?.icon || fallbackIcon"
        :icon="fallbackIcon!"
        :custom-icon="meta?.icon"
        :color="meta?.iconColor"
        :size="16"
        class="mr-1"
      />
    </template>
    {{ displayText }}
  </VChip>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
