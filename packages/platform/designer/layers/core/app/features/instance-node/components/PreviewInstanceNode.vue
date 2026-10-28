<script setup lang="ts">
import type { InputResolverOutput } from "@highstate/backend/shared"
import type { ComponentModel, EntityModel } from "@highstate/contract"
import type { NodeProps } from "@vue-flow/core"
import type { InstanceNodeData } from "#layers/core/app/features/canvas"
import InstanceNode from "./InstanceNode.vue"

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
