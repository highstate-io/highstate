<script setup lang="ts">
import type { ResolvedInstanceInput } from "@highstate/backend/shared"
import type { ComponentModel, EntityModel, InstanceInput, InstanceModel } from "@highstate/contract"
import type { ValidConnectionFunc } from "@vue-flow/core"
import {
  InstanceNodeInputChipPopup,
  InstanceNodeOutputChipPopup,
} from "#layers/core/app/features/entity-explorer"
import InstanceNodeIOSideHandle from "./InstanceNodeIOSideHandle.vue"

const {
  instance,
  component,
  entities,
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
const showAllHandles = computed(
  () => forceShowAllHandles || (!isOutside.value && !preventShowAllHandles),
)

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
</script>

<template>
  <div ref="column" class="d-flex flex-column gr-2 column">
    <VChip
      v-if="
        type === 'inputs' &&
        side === 'left' &&
        Object.keys(component.inputs).length > 0 &&
        (hasInjectionInputs || showAllHandles)
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
        v-else-if="projectId && type === 'inputs'"
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
        v-else-if="shouldShowHandle(name)"
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
</style>
