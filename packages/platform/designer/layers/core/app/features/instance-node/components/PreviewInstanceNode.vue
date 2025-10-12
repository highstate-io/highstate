<script setup lang="ts">
import type { NodeProps } from "@vue-flow/core"
import type { InstanceNodeData } from "#layers/core/app/features/canvas"
import type { ComponentModel, EntityModel } from "@highstate/contract"
import InstanceNode from "./InstanceNode.vue"
import type { InputResolverOutput } from "@highstate/backend/shared"

const { data } = defineProps<
  NodeProps<InstanceNodeData> & {
    components: Record<string, ComponentModel>
    entities: Record<string, EntityModel>
    inputResolverOutputs: ReadonlyMap<string, InputResolverOutput>
    inputResolverDependentMap: ReadonlyMap<string, Iterable<string>>
  }
>()
</script>

<template>
  <InstanceNode
    :instance="data.instance"
    :component="components[data.instance.id]"
    :entities="entities"
    :input-resolver-outputs="inputResolverOutputs"
    :input-resolver-dependent-map="inputResolverDependentMap"
  />
</template>
