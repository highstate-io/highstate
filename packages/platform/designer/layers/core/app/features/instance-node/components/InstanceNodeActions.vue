<script setup lang="ts">
import {
  isInstanceDeployed,
  isTransientInstanceOperationStatus,
  type InstanceState,
} from "@highstate/backend/shared"
import { isUnitModel, type ComponentModel } from "@highstate/contract"
import { GenericIcon } from "#layers/core/app/features/shared"

const {
  component,
  state,
  ghost = false,
} = defineProps<{
  component: ComponentModel
  state?: InstanceState
  locked: boolean
  editable: boolean

  hideShowComposite?: boolean
  loadingSecrets?: boolean
  loadingTerminal?: boolean
  loadingPage?: boolean
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

const hasTerminal = computed(() => state?.terminalIds && state.terminalIds.length > 0)
const hasPage = computed(() => state?.pageIds && state.pageIds.length > 0)

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
    >
      <VIcon>mdi-cancel</VIcon>
    </VBtn>

    <VBtn
      v-if="editable && !ghost && !isRunning"
      size="small"
      variant="tonal"
      class="toolbar-button"
      title="Edit Arguments"
      :locked="locked"
      @click="emit('open:args')"
    >
      <VIcon>mdi-pencil</VIcon>
    </VBtn>

    <VBtn
      v-if="editable && !ghost && !isRunning && hasSecrets"
      size="small"
      variant="tonal"
      class="toolbar-button"
      :loading="loadingSecrets"
      :locked="locked"
      title="Edit Secrets"
      @click="emit('open:secrets')"
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
      :loading="loadingPage"
      @click="emit('open:page')"
    >
      <VIcon>mdi-file-document</VIcon>
    </VBtn>

    <VBtn
      v-if="!ghost && component.kind === 'composite' && !hideShowComposite"
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
