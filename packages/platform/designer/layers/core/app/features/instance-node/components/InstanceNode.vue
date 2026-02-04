<script setup lang="ts">
import {
  getResolvedInjectionInstanceInputs,
  getResolvedInstanceInputs,
  getResolvedInstanceOutputs,
  type InputResolverOutput,
  type InstanceLockOutput,
  type InstanceState,
  type ResolvedInstanceInput,
} from "@highstate/backend/shared"
import {
  isUnitModel,
  type ComponentModel,
  type EntityModel,
  type InstanceId,
  type InstanceInput,
  type InstanceModel,
} from "@highstate/contract"
import { useNode, type ValidConnectionFunc } from "@vue-flow/core"
import { ComponentCard, ComponentIcon } from "#layers/core/app/features/shared"
import {
  InstanceArgumentEditor,
  InstanceSecretEditor,
} from "#layers/core/app/features/instance-editor"
import InstanceNodeArgumentList from "./InstanceNodeArgumentList.vue"
import InstanceStatusFieldList from "./InstanceStatusFieldList.vue"
import InstanceNodeActions from "./InstanceNodeActions.vue"
import InstanceNodeLockBadge from "./InstanceNodeLockBadge.vue"
import InstanceNodeIO from "./InstanceNodeIO.vue"
import { computed, type ComponentInstance } from "vue"
import { getBlueprintStatus } from "#layers/core/app/features/blueprint"

const {
  instance,
  component,
  inputResolverOutputs,
  inputResolverDependentMap,
  allInstances = new Map<string, InstanceModel>(),
  state,
  ioType = "both",
  editable = false,
  ghost = false,
} = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  entities: Record<string, EntityModel | undefined>
  inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>
  inputResolverDependentMap: ReadonlyMap<string, Iterable<string>>
  allInstances?: Map<string, InstanceModel>

  state?: InstanceState
  instanceLock?: InstanceLockOutput

  loadingSecrets?: boolean
  loadingTerminal?: boolean
  loadingPage?: boolean

  initialSecrets?: Record<string, unknown>
  editable?: boolean
  ghost?: boolean

  ioType?: "inputs" | "outputs" | "both"
  ioMirror?: boolean
  hideShowComposite?: boolean

  isValidConnection?: ValidConnectionFunc
}>()

const emit = defineEmits<{
  "open:secrets": []
  "open:terminal": []
  "open:page": []
  "open:composite": []
  "operation:launch": [operation: "update"]
  "operation:cancel": []

  "save:args": [instanceId: InstanceId, newName: string, newArgs: Record<string, unknown>]
  "save:secrets": [stateId: string, secretValues: Record<string, unknown>]

  contextmenu: [event: MouseEvent]
}>()

defineSlots<{
  default: []
  status: []
}>()

const editingSecrets = defineModel<boolean>("editingSecrets", { default: false })
const editingArgs = ref(false)

const hasInputs = computed(() => Object.keys(component.inputs).length > 0)
const hasOutputs = computed(() => Object.keys(component.outputs).length > 0)

const hasInputsOrOutputs = computed(() => hasInputs.value || hasOutputs.value)

const resolvedInputs = computed(() => getResolvedInstanceInputs(inputResolverOutputs, instance.id))
const resolvedInjectionInput = computed(() =>
  getResolvedInjectionInstanceInputs(inputResolverOutputs, instance.id).map(input => input.input),
)

const usedOutputs = computed(() => {
  const resolvedOutputs = getResolvedInstanceOutputs(inputResolverOutputs, instance.id) ?? {}
  const allResolvedOutputs = Object.values(resolvedOutputs).flat()

  const usedOutputs = new Set<string>()
  const dependents = inputResolverDependentMap.get(`instance:${instance.id}`) ?? []

  const handleResolvedInput = (input: InstanceInput) => {
    if (
      input.instanceId === instance.id ||
      // for comosite instances which outputs may be resolved to another instance
      allResolvedOutputs.some(o => o.instanceId === input.instanceId)
    ) {
      usedOutputs.add(input.output)
    }
  }

  for (const dependent of dependents) {
    const result = inputResolverOutputs.get(dependent)
    if (!result) continue

    if (result.kind === "instance") {
      for (const inputs of Object.values(result.instance.inputs ?? {})) {
        for (const input of inputs) {
          handleResolvedInput(input)
        }
      }
    } else {
      for (const input of Object.values(result.hub.inputs ?? {})) {
        handleResolvedInput(input)
      }
    }
  }

  // also check parent resolved outputs
  if (instance.parentId) {
    const parentResolvedOutputs =
      getResolvedInstanceOutputs(inputResolverOutputs, instance.parentId) ?? {}

    for (const output of Object.values(parentResolvedOutputs).flat()) {
      if (output.instanceId === instance.id) {
        usedOutputs.add(output.output)
      }
    }
  }

  return usedOutputs
})

watch(usedOutputs, value => {
  if (value.size === 0) return

  // TODO: call in central place
  vueFlowStore.updateNodeInternals([node.node.id])
})

const { vueFlowStore, selection } = useCanvasStore()

const node = useNode()
const blueprintStatus = computed(() => getBlueprintStatus(node.node, vueFlowStore))

const isConnecting = computed(
  () => vueFlowStore.connectionStartHandle.value?.nodeId === node.node.id,
)

const componentCardRef: Ref<ComponentInstance<typeof ComponentCard> | null> =
  useTemplateRef("componentCard")

// show big icon instead of the component card when zoomed out
const showIconOverlay = computed(() => vueFlowStore.viewport.value.zoom < 0.5)

const overlayIconSize = computed(() =>
  componentCardRef.value
    ? Math.min(componentCardRef.value.$el.clientWidth, componentCardRef.value.$el.clientHeight) *
      0.7
    : 0,
)
</script>

<template>
  <ComponentCard
    :class="{ 'instance-card--ghost': ghost }"
    :component="component"
    :subtitle="instance.name"
    :blueprint-status="blueprintStatus"
    :selected="selection.isNodeSelected(node.node)"
    style="overflow: visible"
    @contextmenu="emit('contextmenu', $event)"
    ref="componentCard"
  >
    <slot />

    <template #append>
      <div class="instance-node__badges">
        <VTooltip v-if="ghost" location="top">
          <template #activator="{ props }">
            <VChip v-bind="props" class="instance-node__ghost-chip" color="primary">
              <VIcon size="16">mdi-ghost</VIcon>
            </VChip>
          </template>
          <span>
            This instance is a ghost. It is no longer a part of the project, but Highstate still
            tracks it.
          </span>
        </VTooltip>

        <InstanceNodeLockBadge v-if="instanceLock" :instance-lock="instanceLock" />
      </div>
    </template>

    <InstanceArgumentEditor
      v-if="editingArgs"
      v-model="editingArgs"
      :instance="instance"
      :component="component"
      :state="state"
      :all-instances="allInstances"
      @save="(instanceId, newName, newArgs) => emit('save:args', instanceId, newName, newArgs)"
    />

    <InstanceSecretEditor
      v-if="isUnitModel(component) && editingSecrets"
      v-model="editingSecrets"
      :instance="instance"
      :state="state"
      :component="component"
      :initial-secrets="initialSecrets ?? {}"
      @save="(stateId, secretValues) => emit('save:secrets', stateId, secretValues)"
    />

    <InstanceNodeArgumentList :instance="instance" :component="component" />

    <template v-if="hasInputsOrOutputs">
      <VDivider />

      <InstanceNodeIO
        :component="component"
        :instance="instance"
        :entities="entities"
        :is-valid-connection="isValidConnection"
        :type="ioType"
        :mirror="ioMirror"
        :used-outputs="usedOutputs"
        :resolved-inputs="resolvedInputs"
        :resolved-injection-input="resolvedInjectionInput"
        :force-show-all-handles="isConnecting"
        :prevent-show-all-handles="editingArgs || editingSecrets || !editable || showIconOverlay"
      />
    </template>

    <InstanceStatusFieldList v-if="state" :instance="instance" :state="state" />

    <VDivider />

    <InstanceNodeActions
      :loading-secrets="loadingSecrets"
      :loading-terminal="loadingTerminal"
      :loading-page="loadingPage"
      :instance="instance"
      :component="component"
      :state="state"
      :locked="!!instanceLock"
      :editable="editable"
      :ghost="ghost"
      :hide-show-composite="hideShowComposite"
      @open:args="editingArgs = true"
      @open:secrets="state ? emit('open:secrets') : (editingSecrets = true)"
      @open:terminal="emit('open:terminal')"
      @open:page="emit('open:page')"
      @open:composite="emit('open:composite')"
      @operation:launch="emit('operation:launch', $event)"
      @operation:cancel="emit('operation:cancel')"
    >
      <template #status>
        <slot name="status" />
      </template>
    </InstanceNodeActions>
  </ComponentCard>

  <VOverlay
    v-model="showIconOverlay"
    scrim="#1e1e1e"
    :opacity="1"
    absolute
    class="align-center justify-center"
    :style="`border: 3px solid ${component.meta.iconColor ?? '#3f51b5'}; border-radius: 8px`"
    contained
  >
    <ComponentIcon :meta="component.meta" :size="overlayIconSize" />
  </VOverlay>
</template>

<style scoped>
.instance-card--ghost {
  opacity: 0.7;
}

.instance-node__badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.instance-node__ghost-chip {
  pointer-events: auto;
}
</style>
