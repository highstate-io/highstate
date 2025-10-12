<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import { InstanceNode } from "#layers/core/app/features/instance-node"
import { InstanceContextMenu } from "#layers/core/app/features/instance-context-menu"
import { InstanceStatusBadge } from "#layers/core/app/features/instance-status"
import type { NodeProps } from "@vue-flow/core"
import type { InstanceNodeData } from "#layers/core/app/features/canvas"

const { instance } = defineProps<
  NodeProps<InstanceNodeData> & {
    instance: InstanceModel
  }
>()

const stores = useProjectStores()
const { instancesStore, libraryStore, stateStore, validationStore, operationsStore } = stores

const instanceLock = computed(() => stateStore.instanceLocks.get(instance.id))

const component = computed(() => libraryStore.library.components[instance.type])
const state = computed(() => stateStore.getInstanceState(instance.id))

const contextMenu = useTemplateRef("contextMenu")
</script>

<template>
  <InstanceNode
    :instance="instance"
    :component="component"
    :entities="libraryStore.library.entities"
    :state="state"
    :editable="instancesStore.instances.has(instance.id)"
    :input-resolver-outputs="instancesStore.inputResolverOutputs"
    :input-resolver-dependent-map="instancesStore.inputResolverDependentMap"
    io-type="inputs"
    :io-mirror="true"
    :hide-show-composite="true"
    @save:args="
      (instanceId, newName, newArgs) => instancesStore.updateInstance(instanceId, newName, newArgs)
    "
    @operation:launch="
      operation => operationsStore.launchInstanceOperation(operation, data.instance)
    "
    @operation:cancel="
      operationsStore.cancelInstanceOperation(
        state.lastOperationState!.operationId,
        data.instance.id,
      )
    "
    @contextmenu="contextMenu?.showContextMenu($event)"
  >
    <template #status>
      <InstanceStatusBadge
        :state="state"
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
      :editable="false"
      :locked="!!instanceLock"
    />
  </InstanceNode>
</template>
