<script setup lang="ts">
import { InlineCopyButton } from "../../shared"

defineProps<{
  item: string
}>()
</script>

<template>
  <VListItem :title="item">
    <template #append>
      <InlineCopyButton :content="item" />
    </template>
  </VListItem>
</template>
