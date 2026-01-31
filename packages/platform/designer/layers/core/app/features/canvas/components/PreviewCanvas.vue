<script setup lang="ts">
import type { ComponentModel, EntityModel, HubModel, InstanceModel } from "@highstate/contract"
import GenericCanvas from "./GenericCanvas.vue"
import { createId } from "@paralleldrive/cuid2"
import { InstanceNode } from "#layers/core/app/features/instance-node"
import HubNode from "./HubNode.vue"

const emit = defineEmits<{
  ready: []
}>()

const {
  instances,
  hubs = [],
  components,
  entities,
  autoPosition = true,
  interactive = false,
} = defineProps<{
  instances: InstanceModel[]
  hubs?: HubModel[]
  components: Record<string, ComponentModel>
  entities: Record<string, EntityModel>
  autoPosition?: boolean
  interactive?: boolean
}>()

const canvasId = createId()
const logger = globalLogger.child({ customCanvasId: canvasId })

const {
  outputs: inputResolverOutputs,
  dependentMap: inputResolverDependentMap,
  set: setInputResolverInput,
  dispatchInitialNodes: dispatchInitialInputResolverNodes,
} = useGraphResolverState("InputResolver", logger, mainResolverWorker, true)

const init = async (canvasStore: CanvasStore) => {
  canvasStore.nodeFactory.createNodesForModels(instances, hubs, { readonly: true })

  for (const instance of instances) {
    const component = components[instance.type]
    setInputResolverInput(`instance:${instance.id}`, { kind: "instance", instance, component })
  }

  for (const hub of hubs) {
    setInputResolverInput(`hub:${hub.id}`, { kind: "hub", hub })
  }

  const promises = [dispatchInitialInputResolverNodes()]

  if (autoPosition) {
    promises.push(
      waitForLayoutCompletion(canvasStore.vueFlowStore)
        .then(() => layoutNodes(canvasStore.vueFlowStore))
        .then(() => canvasStore.vueFlowStore.fitView())
        .then(() => nextTick())
        .then(() =>
          setupEdgeRouter(
            canvasStore.vueFlowStore,
            canvasStore.onNodesMoved,
            canvasStore.edgeEndpointOffsets,
          ),
        ),
    )
  } else {
    promises.push(
      waitForLayoutCompletion(canvasStore.vueFlowStore)
        .then(() => canvasStore.vueFlowStore.fitView())
        .then(() => nextTick())
        .then(() =>
          setupEdgeRouter(
            canvasStore.vueFlowStore,
            canvasStore.onNodesMoved,
            canvasStore.edgeEndpointOffsets,
          ),
        ),
    )
  }

  await Promise.all(promises)

  emit("ready")
}
</script>

<template>
  <GenericCanvas
    :canvas-id="['custom', canvasId]"
    @init="init"
    :input-resolver-outputs="inputResolverOutputs"
    :components="components"
    :entities="entities"
    :minimap="false"
    :interactive="interactive"
  >
    <template #node-instance="{ data }">
      <InstanceNode
        :instance="data.instance"
        :component="components[data.instance.type]"
        :entities="entities"
        :input-resolver-outputs="inputResolverOutputs"
        :input-resolver-dependent-map="inputResolverDependentMap"
        editable
      />
    </template>

    <template #node-hub="{ data }">
      <HubNode :hub="data.hub" />
    </template>
  </GenericCanvas>
</template>
