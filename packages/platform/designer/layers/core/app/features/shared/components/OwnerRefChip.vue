<script setup lang="ts">
import type { ServiceAccountMeta } from "@highstate/contract"
import { InstanceRefChip, ServiceAccountRefChip } from "../index"

const { item } = defineProps<{
  item: {
    stateId?: string | null
    systemName?: string | null
    serviceAccountId?: string | null
    serviceAccountMeta?: ServiceAccountMeta | null
  }
}>()
</script>

<template>
  <InstanceRefChip v-if="item.stateId" :item="{ stateId: item.stateId }" />

  <ServiceAccountRefChip
    v-else-if="item.serviceAccountId"
    :item="{
      serviceAccountId: item.serviceAccountId,
      serviceAccountMeta: item.serviceAccountMeta,
    }"
  />

  <VChip
    v-else-if="item.systemName"
    color="info"
    variant="flat"
    size="small"
    class="font-weight-bold"
  >
    <template #prepend>
      <VIcon class="mr-1">mdi-crown</VIcon>
    </template>
    system
  </VChip>

  <VChip v-else color="secondary" variant="flat" size="small" class="font-weight-bold">
    <template #prepend>
      <VIcon class="mr-1">mdi-help-circle</VIcon>
    </template>
    unknown
  </VChip>
</template>
