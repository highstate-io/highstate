<script setup lang="ts">
import { computed } from "vue"
import type { EdgeProps } from "@vue-flow/core"
import {
  getResolvedInjectionInstanceInputs,
  getResolvedHubInputs,
  getResolvedInstanceInputs,
  getMatchedInjectionInstanceInputs,
  type InputResolverOutput,
} from "@highstate/backend/shared"
import { unique } from "remeda"
import { useVueFlow } from "@vue-flow/core"
import type { ComponentModel, EntityModel } from "@highstate/contract"

const lineWidth = 3

const {
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceHandleId,
  targetHandleId,
  data,
  components,
  inputResolverOutputs,
  entities,
} = defineProps<
  EdgeProps<{
    points?: number[][]
  }> & {
    inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>
    components: Record<string, ComponentModel>
    entities: Record<string, EntityModel>
  }
>()

const vueFlowStore = useVueFlow()

const { inputInstance, outputInstance, inputHub, outputHub, outputKey, inputKey, inputNodeType } =
  getConnectionNodes(vueFlowStore, {
    source,
    target,
    sourceHandle: sourceHandleId,
    targetHandle: targetHandleId,
  })

const entityTypes = computed<{
  all: string[]
  visible?: string[]
}>(() => {
  if (inputNodeType === "outputs") {
    // special case for outputs in composite instances

    const component = components[inputInstance!.type]
    const componentInput = component.outputs[inputKey!]

    return { all: componentInput ? [componentInput.type] : [] }
  }

  if (outputInstance && inputInstance) {
    // instance: direct input

    const component = components[inputInstance.type]
    const componentInput = component.inputs[inputKey]

    return { all: componentInput ? [componentInput.type] : [] }
  }

  if (outputHub && inputInstance && inputKey) {
    // instance: hub input

    const inputs = getResolvedInstanceInputs(inputResolverOutputs, inputInstance.id)

    return {
      all: (inputs[inputKey] ?? []).map(input => input.type),
    }
  }

  if (outputHub && inputInstance) {
    // instance: injection input

    return {
      all: getResolvedInjectionInstanceInputs(inputResolverOutputs, inputInstance.id)
        //
        .map(input => input.type),
      visible: getMatchedInjectionInstanceInputs(inputResolverOutputs, inputInstance.id)
        //
        .map(input => input.type),
    }
  }

  if (outputInstance && inputHub) {
    // hub: direct output

    const component = components[outputInstance.type]
    const componentOutput = component.outputs[outputKey]

    return { all: componentOutput ? [componentOutput.type] : [] }
  }

  if (outputHub && inputHub) {
    // hub: injection output

    return {
      all: getResolvedHubInputs(inputResolverOutputs, outputHub.id)
        .flat()
        .map(input => input.type),
    }
  }

  globalLogger.error({
    msg: "unexpected connection in CustomEdge",
    inputInstance,
    outputInstance,
    inputHub,
    outputHub,
    outputKey,
    inputKey,
  })

  throw new Error("Invalid connection")
})

const connectedEntities = computed(() => unique(entityTypes.value.all).map(type => entities[type]))

const showGhostLine = computed(() => {
  if (!outputHub) return false

  return entityTypes.value.visible
    ? entityTypes.value.visible.length === 0
    : entityTypes.value.all.length === 0
})

const lineCount = computed(() => (showGhostLine.value ? 1 : connectedEntities.value.length))

const getStrokeColor = (index: number) => {
  if (showGhostLine.value) {
    return "#9E9E9E"
  }

  return connectedEntities.value[index % connectedEntities.value.length].meta.color ?? "#607D8B"
}

const isLineVisible = (index: number) => {
  if (showGhostLine.value) {
    return true
  }

  if (entityTypes.value.visible) {
    return entityTypes.value.visible.includes(connectedEntities.value[index].type)
  }

  return true
}

const comparePoints = (a: number[], b: number[]) => {
  return a[0] === b[0] && a[1] === b[1]
}

const allLinePoints = computed(() => {
  if (!data.points) {
    return []
  }

  const startPoint = [sourceX, sourceY]
  const endPoint = [targetX, targetY]

  const points = [...data.points]

  if (!points[0] || !comparePoints(points[0], startPoint)) {
    points.unshift(startPoint)
  }

  if (!points[points.length - 1] || !comparePoints(points[points.length - 1], endPoint)) {
    points.push(endPoint)
  }

  return calculateAllLinePoints(points, lineWidth, lineCount.value)
})

const calculateAnimationDelay = (index: number) => {
  const animationDuration = 1
  const delayStep = animationDuration / lineCount.value

  return `-${index * delayStep}s`
}
</script>

<template>
  <template v-for="(linePoints, index) in allLinePoints" :key="`static-${index}`">
    <polyline
      v-if="isLineVisible(index)"
      :points="linePoints.join(' ')"
      :stroke="getStrokeColor(index)"
      fill="none"
      :stroke-width="lineWidth"
      style="opacity: 0.8"
    />
  </template>

  <template v-for="(linePoints, index) in allLinePoints" :key="`highlight-${index}`">
    <polyline
      v-if="isLineVisible(index)"
      :points="linePoints.join(' ')"
      stroke="white"
      fill="none"
      :stroke-width="lineWidth"
      class="highlight-polyline animated-highlight"
      :style="{ animationDelay: calculateAnimationDelay(index) }"
    />
  </template>
</template>

<style scoped>
.highlight-polyline {
  stroke-width: v-bind(lineWidth);
  stroke-dashoffset: 90;
  opacity: 0.5;
}

.animated-highlight {
  stroke-dasharray: 10 80;
  animation: highlight-animation 1s linear infinite;
}

@keyframes highlight-animation {
  to {
    stroke-dashoffset: 0;
  }
}
</style>
