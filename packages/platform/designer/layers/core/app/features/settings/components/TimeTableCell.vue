<script setup lang="ts">
import { formatDate, getRelativeTime } from "../business/formatters"

const { value } = defineProps<{
  value: Date
}>()
</script>

<template>
  <div>
    <div class="text-body-2">
      {{ formatDate(value) }}
    </div>
    <div class="text-caption text-medium-emphasis">
      {{ getRelativeTime(value) }}
    </div>
  </div>
</template>
