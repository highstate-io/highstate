<script setup lang="ts">
import type { ResolvedInstanceInput } from "@highstate/backend/shared"
import type { ComponentModel, EntityModel, InstanceInput, InstanceModel } from "@highstate/contract"
import type { ValidConnectionFunc } from "@vue-flow/core"
import InstanceNodeIOSideHandle from "./InstanceNodeIOSideHandle.vue"

const {
  instance,
  component,
  entities,
  resolvedInputs,
  preventShowAllHandles,
  forceShowAllHandles,
  resolvedInjectionInput,
} = defineProps<{
  instance: InstanceModel
  component: ComponentModel
  entities: Record<string, EntityModel | undefined>
  type: "inputs" | "outputs"
  side: "left" | "right"
  isValidConnection?: ValidConnectionFunc
  resolvedInputs?: Record<string, ResolvedInstanceInput[]>
  resolvedInjectionInput?: InstanceInput[]
  usedOutputs?: Set<string>
  forceShowAllHandles?: boolean
  preventShowAllHandles?: boolean
}>()

const getHandleColor = (type: "inputs" | "outputs", handleName: string) => {
  const handle = component[type][handleName]

  return entities[handle.type]?.meta.color ?? "#607D8B"
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
      <VChip
        v-if="
          (side === 'right' && type === 'inputs') ||
          (type === 'outputs' && (!usedOutputs || usedOutputs.has(name))) ||
          (type === 'inputs' && (hasInputs(name) || isRequiredAndNotConnected(name))) ||
          showAllHandles
        "
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
