<script setup lang="ts">
import type { ApiKeyMeta } from "@highstate/backend/shared"
import { EntityRefChip } from "../index"

const { projectStore } = useProjectStores()

const { item } = defineProps<{
  item: {
    apiKeyId: string
    apiKeyMeta?: ApiKeyMeta | null
  }
}>()
</script>

<template>
  <EntityRefChip
    :id="item.apiKeyId"
    :meta="item.apiKeyMeta"
    fallback-icon="mdi-key"
    page-name="settings.api-key-details"
    :page-params="{ projectId: projectStore.projectId, apiKeyId: item.apiKeyId }"
  />
</template>
