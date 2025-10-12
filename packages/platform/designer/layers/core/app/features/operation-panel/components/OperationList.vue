<script setup lang="ts">
import OperationCard from "./OperationCard.vue"

const { projectId } = defineProps<{
  projectId: string
}>()

const operationsStore = await useProjectOperationsStore.async(projectId)

const autoUpdate = async () => {
  await operationsStore.launchOperation({
    projectId,
    meta: {
      title: `Auto Update ${operationsStore.instancesToAutoUpdate.length} instance(s)`,
      description: `The operation was started by clicking the auto update button in the operation panel.`,
    },
    type: "update",
    instanceIds: operationsStore.instancesToAutoUpdate.map(instance => instance.id),
  })
}
</script>

<template>
  <div class="d-flex flex-column pl-4 pr-4 gr-4 pt-4 align-center sidebar-container">
    <VBtn
      prepend-icon="mdi-auto-fix"
      color="primary"
      size="large"
      width="360px"
      :disabled="operationsStore.instancesToAutoUpdate.length === 0"
      title="Ебанёт?"
      @click="autoUpdate"
    >
      <div>
        <div class="d-flex" style="line-height: 1">auto update</div>
        <div
          v-if="operationsStore.instancesToAutoUpdate.length > 0"
          class="d-flex text-disabled text-subtitle-1"
          style="line-height: 1"
        >
          {{ operationsStore.instancesToAutoUpdate.length }} component(s)
        </div>
        <div v-else class="d-flex text-disabled text-subtitle-1" style="line-height: 1">
          nothing to update
        </div>
      </div>
    </VBtn>

    <div class="d-flex flex-column gr-4 operation-list-container">
      <OperationCard
        v-for="operation in operationsStore.operations"
        :key="operation.id"
        :operation="operation"
        :operations-store="operationsStore"
      />
    </div>
  </div>
</template>

<style scoped>
.sidebar-container {
  height: 100%;
}

.operation-list-container {
  overflow-y: auto;
  overflow-x: hidden;
  margin-right: -16px;
  padding-right: 8px;
}
</style>
