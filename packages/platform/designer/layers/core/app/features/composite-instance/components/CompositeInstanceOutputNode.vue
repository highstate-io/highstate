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

const { projectStore, instancesStore, libraryStore, stateStore } = useProjectStores()

const component = computed(() => instancesStore.getInstanceComponent(instance))
const state = computed(() => stateStore.getInstanceState(instance.id))
</script>

<template>
  <ComponentCard v-if="component" :component="component" subtitle="Outputs" style="overflow: visible">
    <InstanceNodeIO
      :instance="instance"
      :component="component"
      :entities="libraryStore.library.entities"
      :project-id="projectStore.projectId"
      :state-id="state?.id"
      type="outputs"
      :mirror="true"
    />
  </ComponentCard>
</template>
