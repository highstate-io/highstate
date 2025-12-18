<script setup lang="ts">
import {
  type InstanceState,
  type OperationType,
  isInstanceDeployed,
  isTransientInstanceOperationStatus,
} from "@highstate/backend/shared"
import type { ComponentModel, InstanceModel } from "@highstate/contract"
import { NodeContextMenu, ContextMenuItem } from "#layers/core/app/features/shared"
import InstanceOperationDialog from "./InstanceOperationDialog.vue"
import ForgetInstanceStateDialog from "./ForgetInstanceStateDialog.vue"
import TerminalListSubmenu from "./TerminalListSubmenu.vue"

const {
  instance,
  stores,
  state,
  ghost = false,
} = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  state?: InstanceState
  stores: ProjectStores
  operation?: OperationType
  locked?: boolean
  editable?: boolean
  ghost?: boolean
}>()

const { projectStore, stateStore, operationsStore } = stores
const workspaceStore = useWorkspaceStore()
const { selection } = useCanvasStore()

const visible = ref(false)
const operationDialogVisible = ref(false)
const operationDialogOp = ref<OperationType>("update")
const operationDialogInstances = ref<InstanceModel[]>([])
const forgetStateDialogVisible = ref(false)
const forgetStateDialogInstances = ref<InstanceModel[]>([])

// get selected instances (including current instance if not in multi-selection)
const selectedInstances = computed(() => {
  const isMultiSelect =
    selection.selectedInstances.length > 1 &&
    selection.selectedInstances.some(inst => inst.id === instance.id)
  return isMultiSelect ? selection.selectedInstances : [instance]
})

const isMultipleInstances = computed(() => selectedInstances.value.length > 1)

// check if an instance can perform a specific operation
const canInstancePerformOperation = (
  instance: InstanceModel,
  instanceState: InstanceState | undefined,
  operation: OperationType,
): boolean => {
  if (operation === "preview") {
    if (isMultipleInstances.value) {
      return false
    }

    if (instance.kind !== "unit") {
      return false
    }
  }

  const hasActiveOperation = isTransientInstanceOperationStatus(
    instanceState?.lastOperationState?.status,
  )

  switch (operation) {
    case "update":
      // update/create is available if no active operation is running
      return !hasActiveOperation
    case "refresh":
      // refresh only for deployed instances with no active operation
      return isInstanceDeployed(instanceState) && !hasActiveOperation
    case "preview":
      // preview available if no active operation is running
      return !hasActiveOperation
    case "recreate":
    case "destroy":
      // recreate/destroy only for deployed instances with no active operation
      return isInstanceDeployed(instanceState) && !hasActiveOperation
    default:
      return false
  }
}

// check if operation is available for selected instances (at least one can perform it)
const isOperationAvailable = (operation: OperationType) => {
  if (ghost && operation !== "destroy") {
    return false
  }

  return selectedInstances.value.some(inst => {
    const state = stateStore.instanceStates.get(inst.id)
    return canInstancePerformOperation(inst, state, operation)
  })
}

// check if all instances can perform the operation (for disabled state)
const canAllPerformOperation = (operation: OperationType) => {
  if (ghost && operation !== "destroy") {
    return false
  }

  return selectedInstances.value.every(inst => {
    const state = stateStore.instanceStates.get(inst.id)
    return canInstancePerformOperation(inst, state, operation)
  })
}

// check if any selected instances are deployed
const hasDeployedInstances = computed(() => {
  return selectedInstances.value.some(inst => {
    const state = stateStore.instanceStates.get(inst.id)
    return isInstanceDeployed(state)
  })
})

const getOperationText = (operation: OperationType) => {
  const count = selectedInstances.value.length

  if (count === 1) {
    // single instance - use original logic
    if (operation === "update") {
      return hasDeployedInstances.value ? "Update" : "Create"
    }
    return operation.charAt(0).toUpperCase() + operation.slice(1)
  } else {
    // multiple instances - use "Operation selected (N)" format
    if (operation === "update") {
      const opText = hasDeployedInstances.value ? "Update" : "Create"
      return `${opText} selected (${count})`
    }
    const opText = operation.charAt(0).toUpperCase() + operation.slice(1)
    return `${opText} selected (${count})`
  }
}

const getOperationIcon = (operation: OperationType) => {
  if (isMultipleInstances.value) {
    return "mdi-format-list-bulleted"
  }

  switch (operation) {
    case "update":
      return hasDeployedInstances.value ? "mdi-play" : "mdi-rocket-launch"
    case "refresh":
      return "mdi-reload"
    case "preview":
      return "mdi-eye"
    case "recreate":
      return "mdi-restart"
    case "destroy":
      return "mdi-stop"
    default:
      return "mdi-play"
  }
}

const openOperationDialog = (op: OperationType) => {
  operationDialogOp.value = op
  operationDialogInstances.value = selectedInstances.value
  operationDialogVisible.value = true
  visible.value = false
  selection.clearSelection()
}

const openForgetStateDialog = () => {
  forgetStateDialogInstances.value = selectedInstances.value
  forgetStateDialogVisible.value = true
  visible.value = false
  selection.clearSelection()
}

const contextMenu = useTemplateRef("contextMenu")

const showContextMenu = async (event: MouseEvent) => {
  if (contextMenu.value) {
    await contextMenu.value.showContextMenu(event)
  }
}

const startPreview = async () => {
  if (selectedInstances.value.length !== 1 || instance.kind !== "unit") {
    visible.value = false
    return
  }

  const operation = await operationsStore.launchInstanceOperation("preview", instance)
  visible.value = false

  if (state) {
    await workspaceStore.openLogsPanel(projectStore.projectId, operation.id, state.id)
  }
}

defineExpose({ showContextMenu })
</script>

<template>
  <NodeContextMenu
    ref="contextMenu"
    v-model:visible="visible"
    title="Instance"
    :subtitle="instance.id"
    :is-deletable="node => stores.stateStore.isNodeDeletable(node)"
  >
    <ContextMenuItem
      v-if="isOperationAvailable('update')"
      :title="getOperationText('update')"
      :icon="getOperationIcon('update')"
      color="primary"
      :disabled="locked || !canAllPerformOperation('update')"
      @click="openOperationDialog('update')"
    />

    <ContextMenuItem
      v-if="isOperationAvailable('refresh')"
      :title="getOperationText('refresh')"
      :icon="getOperationIcon('refresh')"
      color="primary"
      :disabled="locked || !canAllPerformOperation('refresh')"
      @click="openOperationDialog('refresh')"
    />

    <!-- TODO: check that all dependencies are met before preview -->
    <ContextMenuItem
      v-if="isOperationAvailable('preview')"
      :title="getOperationText('preview')"
      :icon="getOperationIcon('preview')"
      color="secondary"
      :disabled="locked || !canAllPerformOperation('preview')"
      @click="startPreview"
    />

    <template v-if="!!state?.lastOperationState">
      <VDivider />

      <ContextMenuItem
        title="Open Logs"
        icon="mdi-text"
        color="primary"
        @click="stateStore.openInstanceLogs(instance)"
      />
    </template>

    <VDivider />

    <ContextMenuItem
      title="View in Settings"
      icon="mdi-cog"
      color="primary"
      @click="
        () => {
          const instanceState = stateStore.getInstanceState(instance.id)
          if (instanceState) {
            navigateTo({
              name: 'settings.instance-details',
              params: {
                projectId: projectStore.projectId,
                stateId: instanceState.id,
              },
            })
          }
          visible = false
        }
      "
    />

    <template v-if="state?.terminalIds?.length">
      <VDivider />

      <TerminalListSubmenu :state-id="state.id" :terminal-ids="state.terminalIds" />
    </template>

    <template v-if="hasDeployedInstances">
      <VDivider />

      <ContextMenuItem
        v-if="isOperationAvailable('recreate')"
        :title="getOperationText('recreate')"
        :icon="getOperationIcon('recreate')"
        color="warning"
        :disabled="locked || !canAllPerformOperation('recreate')"
        @click="openOperationDialog('recreate')"
      />

      <ContextMenuItem
        v-if="isOperationAvailable('destroy')"
        :title="getOperationText('destroy')"
        :icon="getOperationIcon('destroy')"
        color="error"
        :disabled="locked || !canAllPerformOperation('destroy')"
        @click="openOperationDialog('destroy')"
      />

      <ContextMenuItem
        :title="
          isMultipleInstances
            ? `Forget State selected (${selectedInstances.length})`
            : 'Forget State'
        "
        icon="mdi-delete-forever"
        color="error"
        :disabled="locked"
        @click="openForgetStateDialog"
      />
    </template>
  </NodeContextMenu>

  <InstanceOperationDialog
    v-model:visible="operationDialogVisible"
    :operation="operationDialogOp"
    :instances="operationDialogInstances"
    :component="component"
  />

  <ForgetInstanceStateDialog
    v-model:visible="forgetStateDialogVisible"
    :instances="forgetStateDialogInstances"
  />
</template>
