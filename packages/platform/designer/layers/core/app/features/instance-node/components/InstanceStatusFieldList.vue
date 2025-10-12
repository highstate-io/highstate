<script setup lang="ts">
import type { InstanceState } from "@highstate/backend/shared"
import type { InstanceModel } from "@highstate/contract"
import InstanceStatusField from "./InstanceStatusField.vue"

const { instance, state } = defineProps<{
  instance: InstanceModel
  state: InstanceState
}>()

const visibleStatusFields = computed(() => {
  return (
    state.statusFields?.filter(statusField => {
      if (statusField.value === undefined) {
        return false
      }

      if (!statusField.complementaryTo) {
        return true
      }

      return (
        !instance.args?.[statusField.complementaryTo] ||
        JSON.stringify(instance.args[statusField.complementaryTo]) !==
          JSON.stringify(statusField.value)
      )
    }) ?? []
  )
})
</script>

<template>
  <template v-if="visibleStatusFields.length > 0">
    <VDivider />

    <VCardText class="d-flex flex-column gap-2 px-2 py-2">
      <InstanceStatusField
        v-for="statusField in visibleStatusFields"
        :key="statusField.name"
        :status-field="statusField"
      />
    </VCardText>
  </template>
</template>
