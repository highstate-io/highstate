<script setup lang="ts">
import type { CommonObjectMeta } from "@highstate/contract"
import { EntityRefChip } from "../index"

const { item } = defineProps<{
  item: {
    workerId: string
    workerVersionId: string
    workerVersionMeta?: CommonObjectMeta | null
  }
}>()
</script>

<template>
  <EntityRefChip
    :id="item.workerVersionId"
    :meta="item.workerVersionMeta"
    fallback-icon="mdi-source-branch"
    page-name="settings.worker-version-details"
    :page-params="{ workerId: item.workerId, versionId: item.workerVersionId }"
  />
</template>
