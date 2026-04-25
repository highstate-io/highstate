<script setup lang="ts">
import { useVueFlow, type Connection, type NodeProps } from "@vue-flow/core"
import InstanceNode from "./InstanceNode.vue"
import { InstanceStatusBadge } from "#layers/core/app/features/instance-status"
import { InstanceContextMenu } from "#layers/core/app/features/instance-context-menu"
import { PageDialog } from "#layers/core/app/features/page-dialog"
import type { InstanceNodeData } from "#layers/core/app/features/canvas"
import type { CommonObjectMeta, PageBlock } from "@highstate/contract"
import { validateConnection } from "#layers/core/app/utils/vue-flow"

const { data, id } = defineProps<NodeProps<InstanceNodeData>>()

const stores = useProjectStores()
const workspaceStore = useWorkspaceStore()
const { projectStore, stateStore, instancesStore, libraryStore, operationsStore, validationStore } =
  stores

const instance = computed(() => data.instance)

const component = computed(() => {
  const component = libraryStore.library.components[instance.value.type]

  if (!component) {
    throw new Error(
      `component "${instance.value.type}" for instance "${instance.value.id}" not found in library`,
    )
  }

  return component
})

const state = computed(() => stateStore.instanceStates.get(instance.value.id))
const instanceLock = computed(() => state.value && stateStore.instanceLocks.get(state.value.id))
const operation = computed(() => operationsStore.getLastInstanceOperation(instance.value.id))
const isGhost = computed(() => instancesStore.isGhostInstance(instance.value.id))

const loadingPage = ref(false)
const pageVisible = ref(false)

const pageMeta = ref<CommonObjectMeta | null>()
const pageContent = ref<PageBlock[]>([])

const editingSecrets = ref(false)
const loadingSecrets = ref(false)
const initialSecrets = ref<Record<string, unknown>>({})

const openPage = async () => {
  loadingPage.value = true

  try {
    if (!state.value?.pageIds) {
      return
    }

    const pageIds = state.value.pageIds
    if (!pageIds.length) {
      return
    }

    const page = await stateStore.getPage(pageIds[0])
    if (!page) {
      return
    }

    pageContent.value = page.content
    pageMeta.value = page.meta
    pageVisible.value = true
  } finally {
    loadingPage.value = false
  }
}

const loadingTerminal = ref(false)

const terminalIds = computed(() => {
  const ownTerminalIds = state.value?.terminalIds ?? []
  if (component.value.kind !== "composite") {
    return ownTerminalIds
  }

  const visitedInstances = new Set<string>()
  const visitedTerminals = new Set<string>()
  const result: string[] = []

  const appendTerminalIds = (ids: string[] | undefined) => {
    for (const terminalId of ids ?? []) {
      if (visitedTerminals.has(terminalId)) {
        continue
      }

      visitedTerminals.add(terminalId)
      result.push(terminalId)
    }
  }

  const visitInstance = (instanceId: string) => {
    if (visitedInstances.has(instanceId)) {
      return
    }

    visitedInstances.add(instanceId)

    const childState = stateStore.instanceStates.get(instanceId)
    appendTerminalIds(childState?.terminalIds)

    for (const child of instancesStore.getInstanceChildren(instanceId)) {
      visitInstance(child.id)
    }
  }

  appendTerminalIds(ownTerminalIds)
  for (const child of instancesStore.getInstanceChildren(instance.value.id)) {
    visitInstance(child.id)
  }

  return result
})

const openTerminal = async () => {
  loadingTerminal.value = true

  try {
    if (terminalIds.value.length === 0) {
      return
    }

    await instancesStore.openTerminal(terminalIds.value[0])
  } finally {
    loadingTerminal.value = false
  }
}

const openSecretsEditor = async () => {
  loadingSecrets.value = true

  try {
    if (!state.value) {
      return
    }

    const secrets = await stores.stateStore.getInstanceSecrets(state.value.id)
    initialSecrets.value = { ...secrets }

    editingSecrets.value = true
  } finally {
    loadingSecrets.value = false
  }
}

const contextMenu = useTemplateRef("contextMenu")
const vueFlowStore = useVueFlow()
const defaultNodeState = ref<{ connectable: boolean; draggable: boolean } | null>(null)

const canConnect = (connection: Connection) => {
  if (isGhost.value) {
    return false
  }

  return validateConnection(
    vueFlowStore,
    libraryStore.library,
    instancesStore.inputResolverOutputs,
    connection,
  )
}

watch(
  () => ({
    ghost: isGhost.value,
    initialized: vueFlowStore.areNodesInitialized.value,
  }),
  ({ ghost, initialized }) => {
    if (!initialized) {
      return
    }

    const node = vueFlowStore.findNode(id)
    if (!node) {
      return
    }

    if (!ghost) {
      if (defaultNodeState.value) {
        const { connectable, draggable } = defaultNodeState.value
        vueFlowStore.updateNode(id, () => ({ connectable, draggable }))
        defaultNodeState.value = null
      }

      return
    }

    if (!defaultNodeState.value) {
      defaultNodeState.value = {
        connectable: Boolean(node.connectable) ?? true,
        draggable: node.draggable ?? true,
      }
    }

    vueFlowStore.updateNode(id, () => ({ connectable: false, draggable: true }))
  },
  { immediate: true },
)
</script>

<template>
  <InstanceNode
    v-model:editing-secrets="editingSecrets"
    :loading-secrets="loadingSecrets"
    :initial-secrets="initialSecrets"
    :loading-page="loadingPage"
    :instance="data.instance"
    :component="component"
    :entities="libraryStore.library.entities"
    :project-id="projectStore.projectId"
    :input-resolver-outputs="instancesStore.inputResolverOutputs"
    :input-resolver-dependent-map="instancesStore.inputResolverDependentMap"
    :is-valid-connection="canConnect"
    :instance-lock="instanceLock"
    :state="state"
    :terminal-ids="terminalIds"
    :editable="data.editable && !isGhost"
    :ghost="isGhost"
    :stores="markRaw(stores)"
    :workspace-store="workspaceStore"
    :all-instances="instancesStore.instances"
    @save:args="
      (instanceId, newName, newArgs) => instancesStore.updateInstance(instanceId, newName, newArgs)
    "
    @save:secrets="
      (stateId, secretValues) => stateStore.updateInstanceSecrets(stateId, secretValues)
    "
    @open:secrets="openSecretsEditor"
    @open:terminal="openTerminal"
    @operation:launch="
      operation => operationsStore.launchQuickInstanceOperation(operation, data.instance)
    "
    @operation:cancel="
      operationsStore.cancelInstanceOperation(
        state!.lastOperationState!.operationId,
        data.instance.id,
      )
    "
    @contextmenu="contextMenu?.showContextMenu($event)"
    @open:composite="workspaceStore.openCompositeInstancePanel(projectStore.projectId, state!.id)"
    @open:page="openPage"
  >
    <template #status>
      <InstanceStatusBadge
        :state="state"
        :operation="operation"
        :expected-input-hash="stateStore.inputHashOutputs.get(instance.id)?.inputHash"
        :validation-output="validationStore.validationOutputs.get(instance.id)"
      />
    </template>

    <InstanceContextMenu
      ref="contextMenu"
      :stores="stores"
      :instance="instance"
      :component="component"
      :state="state"
      :terminal-ids="terminalIds"
      :editable="data.editable && !isGhost"
      :locked="!!instanceLock"
      :ghost="isGhost"
    />

    <PageDialog
      v-if="pageMeta"
      v-model:visible="pageVisible"
      :meta="pageMeta"
      :content="pageContent"
      @close="pageVisible = false"
    />
  </InstanceNode>
</template>
