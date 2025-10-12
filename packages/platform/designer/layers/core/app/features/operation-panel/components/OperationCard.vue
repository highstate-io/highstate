<script setup lang="ts">
import { isFinalOperationStatus, type Operation } from "@highstate/backend/shared"
import {
  ContextMenuItem,
  GenericContextMenu,
  StatusChip,
  operationStatusMap,
  operationTypeMap,
} from "#layers/core/app/features/shared"
import type { ProjectOperationsStore } from "#layers/core/app/stores/project"

const { operation, operationsStore } = defineProps<{
  operation: Operation
  operationsStore: ProjectOperationsStore
}>()

const visible = ref(false)
const cancelling = ref(false)
const contextMenu = useTemplateRef("contextMenu")

const canCancel = computed(() => {
  return !isFinalOperationStatus(operation.status)
})

const handleContextMenu = async (event: MouseEvent) => {
  if (!contextMenu.value) return

  await contextMenu.value.showContextMenu(event)
}

const cancelOperation = async () => {
  if (!canCancel.value || cancelling.value) return

  cancelling.value = true
  try {
    await operationsStore.cancelOperation(operation.id)
    visible.value = false
  } finally {
    cancelling.value = false
  }
}
</script>

<template>
  <div>
    <VCard
      :width="360"
      class="operation-card"
      :color="'#2d2d2d'"
      variant="flat"
      style="border-radius: 4px"
      @contextmenu.prevent="handleContextMenu"
    >
      <template #title>
        <div class="d-flex flex-column ga-4">
          <!-- First row: Title (left) and ID (right) -->
          <div class="d-flex align-center justify-space-between">
            <div class="text-truncate pr-2" style="font-size: 16px; font-weight: 500">
              {{ operation.meta.title }}
            </div>
            <div class="text-caption text-medium-emphasis font-mono text-truncate">
              {{ operation.id.slice(0, 8) }}
            </div>
          </div>
          <!-- Second row: Status (left) and Type (right) -->
          <div class="d-flex align-center justify-space-between">
            <StatusChip :status="operation.status" :status-map="operationStatusMap" />
            <StatusChip :status="operation.type" :status-map="operationTypeMap" />
          </div>
        </div>
      </template>
    </VCard>

    <GenericContextMenu
      ref="contextMenu"
      v-model:visible="visible"
      :title="operation.meta.title"
      :subtitle="operation.id"
    >
      <VDivider />
      <ContextMenuItem
        title="Cancel"
        icon="mdi-cancel"
        color="error"
        :disabled="!canCancel || cancelling"
        :loading="cancelling"
        @click="cancelOperation"
      />
    </GenericContextMenu>
  </div>
</template>

<style scoped>
.operation-card {
  min-height: 90px;
}

.font-mono {
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
}
</style>
