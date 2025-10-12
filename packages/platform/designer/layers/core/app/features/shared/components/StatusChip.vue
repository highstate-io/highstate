<script setup lang="ts">
import type { StatusChipMap } from "../business/status"

const {
  status,
  statusMap,
  size = "small",
} = defineProps<{
  status: string
  statusMap: StatusChipMap
  size?: string
}>()

const getStatusColor = (status: string) => {
  return statusMap[status]?.color ?? "secondary"
}

const getStatusIcon = (status: string) => {
  const statusInfo = statusMap[status]
  if (!statusInfo || "loading" in statusInfo) return undefined
  return statusInfo.icon ?? "mdi-circle"
}

const isLoading = (status: string) => {
  const statusInfo = statusMap[status]
  return statusInfo && "loading" in statusInfo && statusInfo.loading
}

// get icon size based on chip size
const getIconSize = (chipSize: string) => {
  switch (chipSize) {
    case "x-small":
      return 12
    case "small":
      return 16
    case "default":
      return 20
    case "large":
      return 24
    case "x-large":
      return 28
    default:
      return 16
  }
}
</script>

<template>
  <VChip
    :color="getStatusColor(status)"
    :prepend-icon="isLoading(status) ? undefined : getStatusIcon(status)"
    variant="flat"
    :size="size"
    class="font-weight-bold"
  >
    <template v-if="isLoading(status)" #prepend>
      <VProgressCircular :size="getIconSize(size) - 4" :width="2" indeterminate class="mr-2" />
    </template>
    {{ status }}
  </VChip>
</template>
