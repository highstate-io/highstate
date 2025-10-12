<script setup lang="ts">
import type { CommonObjectMeta } from "@highstate/contract"
import type { StatusChipMap } from "#layers/core/app/features/shared/business/status"
import { GenericIcon, StatusChip } from "#layers/core/app/features/shared"

const { meta, fallbackIcon, title, status, statusMap, description } = defineProps<{
  meta?: CommonObjectMeta
  fallbackIcon: string
  title: string
  status?: string
  statusMap?: StatusChipMap
  description?: string
}>()

const slots = defineSlots<{
  actions?: () => VNode
}>()
</script>

<template>
  <div class="settings-page-header">
    <div>
      <div class="d-flex align-center gap-3 mb-1">
        <GenericIcon
          :icon="fallbackIcon"
          :custom-icon="meta?.icon"
          :color="meta?.iconColor"
          :size="32"
          class="mr-4"
        />
        <h1 class="text-h4 font-weight-bold">{{ title }}</h1>
        <StatusChip v-if="status && statusMap" :status="status" :status-map="statusMap" />
      </div>
      <p v-if="description" class="text-body-1 text-medium-emphasis mb-0">
        {{ description }}
      </p>
    </div>

    <!-- Action buttons slot -->
    <div v-if="slots.actions" class="d-flex gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.settings-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-shrink: 0;
  margin-bottom: 24px;
}
</style>
