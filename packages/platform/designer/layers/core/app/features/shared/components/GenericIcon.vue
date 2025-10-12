<script setup lang="ts">
import { Icon } from "@iconify/vue"

const { size = 16 } = defineProps<{
  icon: string
  size?: number
  color?: string
  customIcon?: string
}>()

const customSize = computed(() => size - 4)
</script>

<template>
  <Icon
    v-if="customIcon"
    class="mr-2"
    :icon="customIcon"
    :width="customSize"
    :height="customSize"
    :color="color"
  />
  <VIcon v-else :icon="icon" :size="size" :color="color" />
</template>
