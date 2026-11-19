<script setup lang="ts">
import type { InstanceId } from "@highstate/contract"
import {
  type InstanceState,
  isInstanceDeployed,
  isTransientInstanceOperationStatus,
} from "@highstate/backend/shared"
import { type ComponentModel, isUnitModel } from "@highstate/contract"
import { GenericIcon } from "#layers/core/app/features/shared"

const {
  projectId,
  instanceId,
  component,
  state,
  terminalIds,
  ghost = false,
} = defineProps<{
  projectId?: string
  instanceId?: InstanceId
  component: ComponentModel
  state?: InstanceState
  terminalIds?: string[]
  locked: boolean
  editable: boolean
  canOpenArgsEditor?: boolean
  canEditSecrets?: boolean

  hideShowComposite?: boolean
  loadingSecrets?: boolean
  loadingTerminal?: boolean
  loadingPage?: boolean
  loadingPanel?: boolean
  ghost?: boolean
}>()

const hasSecrets = computed(
  () => isUnitModel(component) && Object.keys(component.secrets).length > 0,
)

const isRunning = computed(() =>
  isTransientInstanceOperationStatus(state?.lastOperationState?.status),
)

const isEvaluating = computed(
  () => state?.evaluationState && state.evaluationState.status === "evaluating",
)

const isProgresIndeterminate = computed(() => {
  return (
    state &&
    (isEvaluating.value ||
      state.lastOperationState?.status === "pending" ||
      state.lastOperationState?.totalResourceCount === 0 ||
      state.lastOperationState?.currentResourceCount === 0 ||
      state.lastOperationState?.currentResourceCount ===
        state.lastOperationState?.totalResourceCount)
  )
})

const progressValue = computed(() => {
  if (!state?.lastOperationState) {
    return 0
  }

  const { currentResourceCount, totalResourceCount } = state.lastOperationState

  return currentResourceCount && totalResourceCount
    ? (currentResourceCount / totalResourceCount) * 100
    : 0
})

const hasTerminal = computed(() => {
  const ids = terminalIds ?? state?.terminalIds ?? []
  return ids.length > 0
})

const hasPage = computed(() => state?.pageIds && state.pageIds.length > 0)
const hasPanel = computed(() => state?.panelIds && state.panelIds.length > 0)

const progressColor = computed(() => {
  if (state?.lastOperationState?.status === "pending") {
    return ""
  }

  return state?.lastOperationState?.status === "destroying" ? "error" : "primary"
})

const emit = defineEmits<{
  "open:args": []
  "open:secrets": []
  "open:terminal": []
  "open:page": []
  "open:panel": []
  "open:composite": []
  "operation:launch": [operation: "update"]
  "operation:cancel": []
}>()

defineSlots<{
  status: []
}>()
</script>

<template>
  <VCardActions class="py-0 h-auto">
    <slot name="status">
      <VChip color="">
        <GenericIcon :size="20" icon="mdi-circle-outline" />
      </VChip>
    </slot>

    <VSpacer />

    <VBtn
      v-if="!ghost && !isInstanceDeployed(state) && !isRunning"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Create"
      :disabled="locked"
      @click="emit('operation:launch', 'update')"
      v-access="projectId ? { permission: 'operation.create', projectId, target: { instanceId } } : undefined"
    >
      <VIcon>mdi-rocket-launch</VIcon>
    </VBtn>

    <VBtn
      v-else-if="!ghost && !isRunning"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Update"
      :disabled="locked"
      @click="emit('operation:launch', 'update')"
      v-access="projectId ? { permission: 'operation.create', projectId, target: { instanceId } } : undefined"
    >
      <VIcon>mdi-play</VIcon>
    </VBtn>

    <VBtn
      v-if="isRunning"
      size="small"
      variant="tonal"
      color="error"
      class="toolbar-button"
      title="Cancel Operation"
      @click="emit('operation:cancel')"
      v-access="projectId ? { permission: 'operation.cancel', projectId, target: { instanceId, resourceId: state?.lastOperationState?.operationId } } : undefined"
    >
      <VIcon>mdi-cancel</VIcon>
    </VBtn>

    <VBtn
      v-if="canOpenArgsEditor && !ghost && !isRunning"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Edit Arguments"
      :locked="locked"
      @click="emit('open:args')"
      v-access="projectId ? { permission: 'instance-model.update', projectId, target: { instanceId } } : undefined"
    >
      <VIcon>mdi-pencil</VIcon>
    </VBtn>

    <VBtn
      v-if="canEditSecrets && !ghost && !isRunning && hasSecrets"
      size="small"
      variant="tonal"
      class="toolbar-button"
      :loading="loadingSecrets"
      :locked="locked"
      title="Edit Secrets"
      @click="emit('open:secrets')"
      v-access="projectId ? [{ permission: 'secret.value.get', projectId, target: { instanceId } }, { permission: 'secret.update', projectId, target: { instanceId } }] : undefined"
    >
      <VIcon>mdi-key</VIcon>
    </VBtn>

    <VBtn
      v-if="!ghost && hasTerminal"
      size="small"
      variant="tonal"
      class="toolbar-button"
      :loading="loadingTerminal"
      title="Open Terminal"
      v-access="projectId ? { permission: 'terminal.connect', projectId, collection: true } : undefined"
      @click="emit('open:terminal')"
    >
      <VIcon>mdi-console</VIcon>
    </VBtn>

    <VBtn
      v-if="!ghost && hasPage"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Open Page"
      v-access="projectId ? { permission: 'page.get', projectId, collection: true } : undefined"
      :loading="loadingPage"
      @click="emit('open:page')"
    >
      <VIcon>mdi-file-document</VIcon>
    </VBtn>

    <VBtn
      v-if="!ghost && hasPanel"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Open Panel"
      v-access="projectId ? { permission: 'panel.get', projectId, collection: true } : undefined"
      :loading="loadingPanel"
      @click="emit('open:panel')"
    >
      <VIcon>mdi-view-dashboard-outline</VIcon>
    </VBtn>

    <VBtn
      v-if="component.kind === 'composite' && !hideShowComposite"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Show Structure"
      @click="emit('open:composite')"
    >
      <VIcon>mdi-cube-outline</VIcon>
    </VBtn>

    <VProgressLinear
      v-if="isEvaluating || isRunning"
      size="small"
      :color="progressColor"
      :indeterminate="isProgresIndeterminate"
      :model-value="progressValue"
      absolute
      location="bottom"
    />
  </VCardActions>
</template>

<style scoped>
.toolbar-button {
  min-width: 0;
}
</style>
