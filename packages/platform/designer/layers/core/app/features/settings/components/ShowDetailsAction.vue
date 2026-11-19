<script setup lang="ts">
import { TableItemAction } from "#layers/core/app/features/settings"
import { routeAccess } from "../../../utils/access-policy"

const {
  pageName,
  pageParams,
  variant = "text",
  size = "small",
  disabled = false,
} = defineProps<{
  pageName: string
  pageParams: Record<string, string>
  variant?: "text" | "outlined" | "flat" | "elevated" | "tonal" | "plain"
  size?: "x-small" | "small" | "default" | "large" | "x-large"
  disabled?: boolean
}>()

const handleClick = () => {
  navigateTo({
    name: pageName,
    params: pageParams,
  })
}
</script>

<template>
  <TableItemAction
    :access="routeAccess(pageName, pageParams)"
    icon="mdi-eye"
    tooltip="View Details"
    :variant="variant"
    :size="size"
    :disabled="disabled"
    @click="handleClick"
  />
</template>
