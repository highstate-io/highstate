<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import { ComponentCard } from "#layers/core/app/features/shared"
import { InstanceNodeIO } from "#layers/core/app/features/instance-node"
import type { NodeProps } from "@vue-flow/core"
import type { InstanceNodeData } from "#layers/core/app/features/canvas"

const { instance } = defineProps<
  NodeProps<InstanceNodeData> & {
    instance: InstanceModel
  }
>()

const { libraryStore } = useProjectStores()

const component = computed(() => libraryStore.library.components[instance.type])
</script>

<template>
  <ComponentCard :component="component" subtitle="Outputs" style="overflow: visible">
    <InstanceNodeIO
      :instance="instance"
      :component="component"
      :entities="libraryStore.library.entities"
      type="outputs"
      :mirror="true"
    />
  </ComponentCard>
</template>
