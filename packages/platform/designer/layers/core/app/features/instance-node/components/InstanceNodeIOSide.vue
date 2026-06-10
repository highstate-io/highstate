<script setup lang="ts">
import { SYSTEM_EXPORT_COMPONENT_TYPE, type ResolvedInstanceInput } from "@highstate/backend/shared"
import {
  camelCaseToHumanReadable,
  type ComponentModel,
  type EntityModel,
  type InstanceInput,
  type InstanceModel,
} from "@highstate/contract"
import { useVueFlow, type ValidConnectionFunc } from "@vue-flow/core"
import {
  InstanceNodeInputChipPopup,
  InstanceNodeOutputChipPopup,
} from "#layers/core/app/features/entity-explorer"
import InstanceNodeIOSideHandle from "./InstanceNodeIOSideHandle.vue"
import InstanceNodeEditableInputChip from "./InstanceNodeEditableInputChip.vue"
import { EXPORT_CREATE_INPUT_HANDLE } from "#layers/core/app/utils/vue-flow"

const {
  instance,
  component,
  entities,
  editable = false,
  type,
  side,
  projectId,
  stateId,
  isValidConnection,
  resolvedInputs,
  preventShowAllHandles,
  forceShowAllHandles,
  resolvedInjectionInput,
  usedOutputs,
} = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  entities: Record<string, EntityModel | undefined>
  editable?: boolean
  type: "inputs" | "outputs"
  side: "left" | "right"
  projectId?: string
  stateId?: string
  isValidConnection?: ValidConnectionFunc
  resolvedInputs?: Record<string, ResolvedInstanceInput[]>
  resolvedInjectionInput?: InstanceInput[]
  usedOutputs?: Set<string>
  forceShowAllHandles?: boolean
  preventShowAllHandles?: boolean
}>()

const getResolvedInputType = (inputName: string): string | undefined => {
  const types = Array.from(new Set((resolvedInputs?.[inputName] ?? []).map(input => input.type)))

  if (types.length !== 1) {
    return undefined
  }

  return types[0]
}

const getHandleType = (ioType: "inputs" | "outputs", handleName: string): string => {
  const handle = component[ioType][handleName]

  if (ioType === "inputs") {
    return getResolvedInputType(handleName) ?? handle.type
  }

  if (handle.fromInput) {
    return getResolvedInputType(handle.fromInput) ?? handle.type
  }

  return handle.type
}

const getHandleColor = (type: "inputs" | "outputs", handleName: string) => {
  return entities[getHandleType(type, handleName)]?.meta.color ?? "#607D8B"
}

const getHandleTextColor = (type: "inputs" | "outputs", handleName: string) => {
  return getTextColorByBackgroundColor(getHandleColor(type, handleName))
}

const hasInputs = (name: string) => {
  const hasInputs = instance.inputs && !!instance.inputs[name] && instance.inputs[name].length > 0
  const hasHubInputs =
    instance.hubInputs && !!instance.hubInputs[name] && instance.hubInputs[name].length > 0

  return hasInputs || hasHubInputs
}

const isRequiredAndNotConnected = (name: string) => {
  const input = component.inputs[name]
  if (!input.required) return false

  return !resolvedInputs?.[name]?.length
}

const columnEl = useTemplateRef("column")
const { isOutside } = useMouseInElement(columnEl)
const showHandlesOnHover = computed(() => !isOutside.value && !preventShowAllHandles)
const showAllHandles = computed(() => forceShowAllHandles || showHandlesOnHover.value)

const shouldShowHandle = (name: string) => {
  if (type === "outputs") {
    return !usedOutputs || usedOutputs.has(name) || showAllHandles.value
  }

  return (
    side === "right" || hasInputs(name) || isRequiredAndNotConnected(name) || showAllHandles.value
  )
}

const injectionInputText = computed(() => {
  if (!resolvedInjectionInput) {
    return "no inputs"
  }

  if (resolvedInjectionInput.length === 1) {
    return `1 input`
  }

  return `${resolvedInjectionInput.length} inputs`
})

const hasInjectionInputs = computed(
  () => instance.injectionInputs && instance.injectionInputs.length > 0,
)

const isEditableExportInputsColumn = computed(() => {
  return (
    editable &&
    instance.type === SYSTEM_EXPORT_COMPONENT_TYPE &&
    type === "inputs" &&
    side === "left"
  )
})

const vueFlowStore = useVueFlow()

const showCreateInputHandle = computed(() => {
  if (!isEditableExportInputsColumn.value) {
    return false
  }

  return !!vueFlowStore.connectionStartHandle.value
})

const editableExportReservedLabelWidthCh = computed(() => {
  if (!isEditableExportInputsColumn.value) {
    return 8
  }

  const names = Object.keys(component.inputs)
  if (names.length === 0) {
    return 8
  }

  const maxLength = Math.max(...names.map(name => camelCaseToHumanReadable(name).length), 8)

  return Math.min(maxLength + 1, 28)
})

const renameEditableExportInput = async (oldName: string, newName: string) => {
  if (!projectId) {
    throw new Error("Project ID is required")
  }

  const { instancesStore } = useExplicitProjectStores(projectId)
  await instancesStore.renameEditableExportInput(instance, oldName, newName)
}
</script>

<template>
  <div ref="column" class="d-flex flex-column gr-2 column">
    <VChip
      v-if="
        !isEditableExportInputsColumn &&
        type === 'inputs' &&
        side === 'left' &&
        Object.keys(component.inputs).length > 0 &&
        (hasInjectionInputs || showHandlesOnHover)
      "
      :style="{
        backgroundColor: '#3F51B5',
        color: 'white',
      }"
      text-color="white"
      class="rounded handle-chip"
    >
      <VIcon class="mr-1" style="margin-left: -2px">mdi-router</VIcon>
      {{ injectionInputText }}
      <InstanceNodeIOSideHandle
        name=""
        :side="side"
        :is-valid-connection="isValidConnection"
        handle-color="#3F51B5"
      />
    </VChip>

    <template v-for="(item, name) in component[type]" :key="name">
      <InstanceNodeOutputChipPopup
        v-if="type === 'outputs'"
        :project-id="projectId"
        :state-id="stateId"
        :output="name"
        :output-sources="instance.resolvedOutputs?.[name]"
        :entities="entities"
      >
        <template #activator="{ props: menuProps, opened }">
          <VChip
            v-if="shouldShowHandle(name) || opened"
            v-bind="menuProps"
            :style="{
              backgroundColor: getHandleColor(type, name),
              color: getHandleTextColor(type, name),
            }"
            text-color="white"
            class="rounded handle-chip"
          >
            {{ item.meta.title }}
            <InstanceNodeIOSideHandle
              :name="name"
              :side="side"
              :is-valid-connection="isValidConnection"
              :handle-color="getHandleColor(type, name)"
            />
          </VChip>
        </template>
      </InstanceNodeOutputChipPopup>

      <InstanceNodeInputChipPopup
        v-else-if="isEditableExportInputsColumn && projectId && type === 'inputs'"
        :project-id="projectId"
        :resolved-inputs="resolvedInputs?.[name] ?? []"
        :entities="entities"
      >
        <template #activator="{ props: menuProps, opened }">
          <div v-if="shouldShowHandle(name) || opened" v-bind="menuProps">
            <InstanceNodeEditableInputChip
              :name="name"
              :side="side"
              :reserved-label-width-ch="editableExportReservedLabelWidthCh"
              :chip-background-color="getHandleColor(type, name)"
              :chip-text-color="getHandleTextColor(type, name)"
              :is-valid-connection="isValidConnection"
              :rename-input="renameEditableExportInput"
            />
          </div>
        </template>
      </InstanceNodeInputChipPopup>

      <InstanceNodeInputChipPopup
        v-else-if="!isEditableExportInputsColumn && projectId && type === 'inputs'"
        :project-id="projectId"
        :resolved-inputs="resolvedInputs?.[name] ?? []"
        :entities="entities"
      >
        <template #activator="{ props: menuProps, opened }">
          <VChip
            v-if="shouldShowHandle(name) || opened"
            v-bind="menuProps"
            :style="{
              backgroundColor: getHandleColor(type, name),
              color: getHandleTextColor(type, name),
            }"
            text-color="white"
            class="rounded handle-chip"
          >
            {{ item.meta.title }}
            <InstanceNodeIOSideHandle
              :name="name"
              :side="side"
              :is-valid-connection="isValidConnection"
              :handle-color="getHandleColor(type, name)"
            />
          </VChip>
        </template>
      </InstanceNodeInputChipPopup>

      <VChip
        v-else-if="!isEditableExportInputsColumn && shouldShowHandle(name)"
        :style="{
          backgroundColor: getHandleColor(type, name),
          color: getHandleTextColor(type, name),
        }"
        text-color="white"
        class="rounded handle-chip"
      >
        {{ item.meta.title }}
        <InstanceNodeIOSideHandle
          :name="name"
          :side="side"
          :is-valid-connection="isValidConnection"
          :handle-color="getHandleColor(type, name)"
        />
      </VChip>
    </template>

    <VChip
      v-if="showCreateInputHandle"
      class="rounded handle-chip create-input-chip"
      variant="outlined"
    >
      create input
      <InstanceNodeIOSideHandle
        :name="EXPORT_CREATE_INPUT_HANDLE"
        :side="side"
        :is-valid-connection="isValidConnection"
        handle-color="transparent"
        compact
      />
    </VChip>
  </div>
</template>

<style scoped>
.column {
  flex: 1;
  max-width: 50%;
}

.handle-chip {
  position: relative;
  overflow: visible;
}

.create-input-chip {
  border-style: dashed;
  border-width: 2px;
}
</style>
