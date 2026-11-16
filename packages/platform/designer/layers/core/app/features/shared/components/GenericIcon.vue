<script setup lang="ts">
import { Icon } from "@iconify/vue"

const { size = 16, customIcon } = defineProps<{
  icon: string
  size?: number
  color?: string
  customIcon?: string
}>()

const customSize = computed(() => size - 4)

const materialIcon = computed(() =>
  customIcon?.startsWith("mdi:")
    ? customIcon.replace("mdi:", "mdi-")
    : customIcon?.startsWith("mdi-")
      ? customIcon
      : undefined,
)
</script>

<template>
  <Icon
    v-if="customIcon && !materialIcon"
    class="mr-2"
    :icon="customIcon"
    :width="customSize"
    :height="customSize"
    :color="color"
  />
  <VIcon
    v-else
    :icon="materialIcon ?? icon"
    :size="materialIcon ? customSize : size"
    :color="color"
    :class="{ 'mr-2': materialIcon }"
  />
</template>
