<script setup lang="ts">
import type {
  OperationType,
  OperationPhase,
  OperationOptions as OperationOptionsType,
} from "@highstate/backend/shared"
import type { ComponentModel, InstanceModel } from "@highstate/contract"
import { ComponentIcon } from "#layers/core/app/features/shared"
import OperationPlanTree from "./OperationPlanTree.vue"
import OperationOptions from "./OperationOptions.vue"

const visible = defineModel<boolean>("visible")

const { operationsStore, projectStore } = useProjectStores()

const { instances, component, operation } = defineProps<{
  instances: InstanceModel[]
  component?: ComponentModel
  operation: OperationType
}>()

const isMultipleInstances = computed(() => instances.length > 1)
const firstInstance = computed(() => instances[0])

const options = ref<OperationOptionsType>({
  forceUpdateDependencies: false,
  ignoreDependencies: false,
  forceUpdateChildren: false,
  destroyDependentInstances: false,
  invokeDestroyTriggers: true,
  deleteUnreachableResources: false,
  forceDeleteState: false,
  allowPartialCompositeInstanceUpdate: false,
  allowPartialCompositeInstanceDestruction: false,
  refresh: false,
})

const operationPlan = ref<OperationPhase[]>([])
const planLoading = ref(false)
const planError = ref<string | null>(null)

const operationTitle = ref("")
const operationDescription = ref("")

watch(
  [() => operation, () => instances],
  () => {
    if (instances.length === 0) return

    // set default title based on operation and instances
    operationTitle.value = isMultipleInstances.value
      ? generateMultipleInstancesOperationTitle(operation, instances)
      : generateOperationTitle(operation, firstInstance.value)

    // automatically adjust destroyDependentInstances option for destroy operation
    options.value = {
      ...options.value,
      destroyDependentInstances: operation === "destroy",
    }
  },
  { immediate: true },
)

watch(
  () => options.value,
  () => {
    requestPlan()
  },
  { deep: true },
)

watch(
  () => visible.value,
  newVisible => {
    if (newVisible) {
      requestPlan()
    }
  },
)

const requestPlan = async () => {
  if (!visible.value) return

  planLoading.value = true
  planError.value = null

  try {
    const newPlan = await operationsStore.planOperation({
      projectId: projectStore.projectId,
      type: operation,
      instanceIds: instances.map(inst => inst.id),
      options: options.value,
    })

    operationPlan.value = newPlan
  } catch (error) {
    console.error("Failed to load operation plan:", error)
    planError.value = error instanceof Error ? error.message : "Unknown error"
  } finally {
    planLoading.value = false
  }
}

const phaseCounts = computed(() => {
  const updateInstances = new Set<string>()
  const destroyInstances = new Set<string>()
  const refreshInstances = new Set<string>()
  const previewInstances = new Set<string>()
  const uniqueInstances = new Set<string>()

  for (const phase of operationPlan.value) {
    for (const instance of phase.instances) {
      uniqueInstances.add(instance.id)

      if (phase.type === "update") {
        updateInstances.add(instance.id)
        continue
      }

      if (phase.type === "destroy") {
        destroyInstances.add(instance.id)
        continue
      }

      if (phase.type === "refresh") {
        refreshInstances.add(instance.id)
        continue
      }

      if (phase.type === "preview") {
        previewInstances.add(instance.id)
      }
    }
  }

  return {
    update: updateInstances.size,
    destroy: destroyInstances.size,
    refresh: refreshInstances.size,
    preview: previewInstances.size,
    unique: uniqueInstances.size,
  }
})

const formatInstanceCount = (count: number) =>
  `${count} instance${count === 1 ? "" : "s"}`

const opText = computed(() => {
  switch (operation) {
    case "update":
      return "Update"
    case "preview":
      return "Preview"
    case "refresh":
      return "Refresh"
    case "destroy":
      return "Destroy"
    case "recreate":
      return "Recreate"
    default:
      return "Unknown operation"
  }
})

const opButtonText = computed(() => {
  const counts = phaseCounts.value

  switch (operation) {
    case "update": {
      const { update } = counts

      if (update === 0) {
        return opText.value
      }

      return `Update ${formatInstanceCount(update)}`
    }
    case "recreate": {
      if (counts.unique === 0) {
        return opText.value
      }

      return `Recreate ${formatInstanceCount(counts.unique)}`
    }
    case "destroy": {
      if (counts.destroy === 0) {
        return opText.value
      }

      return `Destroy ${formatInstanceCount(counts.destroy)}`
    }
    case "refresh": {
      if (counts.refresh === 0) {
        return opText.value
      }

      return `Refresh ${formatInstanceCount(counts.refresh)}`
    }
    case "preview": {
      if (counts.preview === 0) {
        return opText.value
      }

      return `Preview ${formatInstanceCount(counts.preview)}`
    }
    default: {
      if (counts.unique === 0) {
        return opText.value
      }

      return `${opText.value} ${formatInstanceCount(counts.unique)}`
    }
  }
})

const opButtonColor = computed(() => {
  switch (operation) {
    case "update":
      return "primary"
    case "preview":
      return "secondary"
    case "refresh":
      return "info"
    case "destroy":
      return "error"
    case "recreate":
      return "warning"
    default:
      return "primary"
  }
})

const loading = ref(false)

const operate = async () => {
  loading.value = true

  try {
    await operationsStore.launchOperation({
      projectId: projectStore.projectId,
      type: operation,
      instanceIds: instances.map(inst => inst.id),
      options: options.value,
      meta: {
        title: operationTitle.value,
        description: operationDescription.value,
      },
    })
    visible.value = false
  } finally {
    loading.value = false
  }
}

const title = computed(() => {
  if (isMultipleInstances.value) {
    return `${opText.value} ${instances.length} instances`
  } else if (component) {
    return `${opText.value} ${component.meta.title} "${firstInstance.value.name}"`
  } else {
    return `${opText.value} "${firstInstance.value.name}"`
  }
})
</script>

<template>
  <VDialog v-model="visible" max-width="1200px" class="operation-dialog">
    <VCard :title="title" :color="component?.meta.color ?? '#2d2d2d'" class="operation-card">
      <template #prepend>
        <ComponentIcon v-if="component && !isMultipleInstances" :meta="component.meta" />
        <VIcon v-else-if="isMultipleInstances">mdi-format-list-bulleted</VIcon>
        <VIcon v-else>mdi-cube-outline</VIcon>
      </template>

      <VCardText class="operation-card-content">
        <VContainer fluid class="pa-0 fill-height">
          <VRow no-gutters class="fill-height">
            <!-- Left Column: Meta and Options -->
            <VCol cols="12" md="5" class="pr-md-4 column-container">
              <div class="metadata-section">
                <div class="text-overline mb-2">Metadata</div>
                <VTextField
                  v-model="operationTitle"
                  label="Title"
                  variant="outlined"
                  density="compact"
                  class="mb-3"
                  hint="A descriptive title for this operation (optional)"
                  persistent-hint
                />
                <VTextarea
                  v-model="operationDescription"
                  label="Description"
                  variant="outlined"
                  density="compact"
                  rows="2"
                  hint="Describe the purpose of this operation (optional)"
                  persistent-hint
                />
              </div>

              <VDivider class="my-4" />

              <div class="options-header">
                <div class="text-overline mb-2">Options</div>
                <p class="text-body-2 text-medium-emphasis mb-4">
                  Configure how the
                  <b>{{ operation }}</b>
                  operation should be executed. These options control the behavior and scope of the
                  operation.
                </p>
              </div>
              <div class="options-scrollable">
                <OperationOptions v-model:options="options" :operation="operation" />
              </div>
            </VCol>

            <VDivider vertical class="d-none d-md-flex" />

            <!-- Right Column: Plan -->
            <VCol cols="12" md="7" class="pl-md-4 column-container">
              <div class="plan-header">
                <div class="text-overline mb-2">Execution Plan</div>
                <p class="text-body-2 text-medium-emphasis mb-4">
                  Preview of instances that will be affected by this operation. The plan shows the
                  execution phases and which instances will be processed.
                </p>
                <VAlert
                  v-if="planError"
                  type="error"
                  variant="outlined"
                  density="compact"
                  class="mb-3"
                >
                  Failed to load operation plan: {{ planError }}
                </VAlert>
              </div>
              <div class="plan-scrollable">
                <OperationPlanTree :phases="operationPlan" />
              </div>
            </VCol>
          </VRow>
        </VContainer>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn @click="visible = false">Cancel</VBtn>
        <VBtn :color="opButtonColor" :loading="loading" :disabled="planLoading" @click="operate">
          {{ opButtonText }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.operation-dialog :deep(.v-overlay__content) {
  height: 80vh;
  max-height: 80vh;
}

.operation-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.operation-card-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.metadata-section {
  flex-shrink: 0;
}

.options-header,
.plan-header {
  flex-shrink: 0;
}

.options-scrollable,
.plan-scrollable {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: 960px) {
  .column-container {
    height: auto;
  }

  .options-scrollable,
  .plan-scrollable {
    max-height: 300px;
  }
}

@media (max-width: 600px) {
  .operation-dialog :deep(.v-overlay__content) {
    height: 90vh;
    max-height: 90vh;
  }
}
</style>
