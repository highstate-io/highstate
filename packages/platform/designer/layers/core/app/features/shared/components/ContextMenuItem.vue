<script setup lang="ts">
import { Icon } from "@iconify/vue"

defineProps<{
  title: string
  subtitle?: string
  color?: string
  icon?: string
  customIcon?: string
  disabled?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <VListItem :disabled="disabled" @click="emit('click')">
    <template v-if="loading" #prepend>
      <VProgressCircular indeterminate color="primary" />
    </template>
    <template v-else-if="customIcon" #prepend>
      <Icon
        :icon="customIcon!"
        :color="color"
        style="margin-right: 12px; width: 24px; height: 24px"
      />
    </template>
    <template v-else-if="icon" #prepend>
      <VIcon :color="color" style="margin-right: -20px">{{ icon }}</VIcon>
    </template>
    <template #append>
      <slot name="append" />
    </template>
    <VListItemTitle :color="color">{{ title }}</VListItemTitle>
    <VListItemSubtitle v-if="subtitle" :color="color">{{ subtitle }}</VListItemSubtitle>
    <slot />
  </VListItem>
</template>
