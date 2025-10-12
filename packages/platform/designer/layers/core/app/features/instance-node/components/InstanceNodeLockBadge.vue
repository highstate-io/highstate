<script setup lang="ts">
import type { InstanceLockOutput } from "@highstate/backend/shared"
import { Icon } from "@iconify/vue"

defineProps<{
  instanceLock: InstanceLockOutput
}>()
</script>

<template>
  <VTooltip :disabled="!instanceLock.meta.title && !instanceLock.meta.description">
    <template #activator="{ props }">
      <VChip v-bind="props">
        <VIcon>mdi-lock</VIcon>
        <Icon
          v-if="instanceLock.meta.icon"
          class="ml-1"
          :icon="instanceLock.meta.icon"
          :width="18"
          :color="instanceLock.meta.iconColor"
        />
      </VChip>
    </template>

    <div v-if="instanceLock.meta.title" class="text-h6">
      {{ instanceLock.meta.title }}
    </div>

    <div v-if="instanceLock.meta.description">
      {{ instanceLock.meta.description }}
    </div>
  </VTooltip>
</template>
