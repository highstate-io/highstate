<script setup lang="ts">
import type { ServiceAccountMeta } from "@highstate/contract"
import { EntityRefChip } from "../index"

const { projectStore } = useProjectStores()

const { item } = defineProps<{
  item: {
    serviceAccountId: string
    serviceAccountMeta?: ServiceAccountMeta | null
  }
}>()
</script>

<template>
  <EntityRefChip
    :id="item.serviceAccountId"
    :meta="item.serviceAccountMeta"
    fallback-icon="mdi-account-circle"
    page-name="settings.service-account-details"
    :page-params="{ projectId: projectStore.projectId, serviceAccountId: item.serviceAccountId }"
  />
</template>
