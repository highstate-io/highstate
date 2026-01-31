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
import type { RoutedEdgeData } from "../business"

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
  EdgeProps<RoutedEdgeData> & {
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

const hubLaneTypes = computed(() => {
  if (!outputHub) {
    return [] as string[]
  }

  const types = getResolvedHubInputs(inputResolverOutputs, outputHub.id).map(input => input.type)
  return unique(types).sort()
})

const hubReservedGhostLane = computed(() => {
  return !!outputHub && data.hubReservedGhostLane
})

const isPendingHubTyped = computed(() => {
  return !!outputHub && data.isPendingHubTyped
})

const isTypedHubToComponentInputForGhost = computed(() => {
  return !!outputHub && !!inputInstance && !!inputKey
})

const typedInputExpectedTypeForGhost = computed((): string | undefined => {
  if (!isTypedHubToComponentInputForGhost.value) {
    return undefined
  }

  const component = components[inputInstance!.type]
  return component.inputs[inputKey!]?.type
})

const isPendingTypedHubToComponentForGhost = computed(() => {
  if (!outputHub || !isTypedHubToComponentInputForGhost.value) {
    return false
  }

  const expected = typedInputExpectedTypeForGhost.value
  if (!expected) {
    return false
  }

  return !hubLaneTypes.value.includes(expected)
})

const effectiveIsPendingHubTyped = computed(() => {
  return isPendingHubTyped.value || isPendingTypedHubToComponentForGhost.value
})

const shouldShowHubGhostLane = computed(() => {
  if (!outputHub) {
    return false
  }

  // Pending typed edges must always show a ghost line.
  // This makes the edge visible even if the hub-wide reserved lane flag didn't propagate yet.
  if (effectiveIsPendingHubTyped.value) {
    return true
  }

  return hubReservedGhostLane.value
})

const hubGhostLaneEnabled = computed(() => {
  return shouldShowHubGhostLane.value && hubLaneTypes.value.length > 0
})

const showGhostLine = computed(() => {
  if (!outputHub) {
    return false
  }

  return entityTypes.value.visible
    ? entityTypes.value.visible.length === 0
    : entityTypes.value.all.length === 0
})

const lineCount = computed(() => {
  if (!outputHub) {
    return showGhostLine.value ? 1 : connectedEntities.value.length
  }

  if (isTypedHubToComponentInput.value) {
    return 1
  }

  const base = hubLaneTypes.value.length
  const total = base + (hubGhostLaneEnabled.value ? 1 : 0)

  return Math.max(1, total)
})

const isGhostLane = (index: number) => {
  if (!outputHub) {
    return showGhostLine.value
  }

  if (hubLaneTypes.value.length === 0) {
    return true
  }

  return hubGhostLaneEnabled.value && index === lineCount.value - 1
}

const isTypedHubToComponentInput = computed(() => {
  return !!outputHub && !!inputInstance && !!inputKey
})

const getTypedInputExpectedType = (): string | undefined => {
  if (!isTypedHubToComponentInput.value) {
    return undefined
  }

  const component = components[inputInstance!.type]
  return component.inputs[inputKey!]?.type
}

const isPendingTypedHubToComponentInput = computed(() => {
  if (!isTypedHubToComponentInput.value) {
    return false
  }

  const expected = getTypedInputExpectedType()
  if (!expected) {
    return false
  }

  return !hubLaneTypes.value.includes(expected)
})

const getStrokeColor = (index: number) => {
  if (isTypedHubToComponentInput.value) {
    if (isPendingTypedHubToComponentInput.value) {
      return "#9E9E9E"
    }

    const expected = getTypedInputExpectedType()
    const entity = expected ? entities[expected] : undefined

    return entity?.meta.color ?? "#607D8B"
  }

  if (isGhostLane(index)) {
    return "#9E9E9E"
  }

  if (outputHub) {
    const type = hubLaneTypes.value[index]
    const entity = entities[type]

    return entity?.meta.color ?? "#607D8B"
  }

  return connectedEntities.value[index % connectedEntities.value.length].meta.color ?? "#607D8B"
}

const isLineVisible = (index: number) => {
  if (outputHub) {
    if (isTypedHubToComponentInput.value) {
      return index === 0
    }

    if (showGhostLine.value) {
      return isGhostLane(index)
    }

    if (entityTypes.value.visible) {
      if (isGhostLane(index)) {
        return false
      }

      return entityTypes.value.visible.includes(hubLaneTypes.value[index])
    }

    return !isGhostLane(index)
  }

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

  const startPoint = [sourceX, data.routedSourceY ?? sourceY]
  const endPoint = [targetX, data.routedTargetY ?? targetY]

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
