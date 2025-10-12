<script setup lang="ts">
import { type NodeProps } from "@vue-flow/core"
import HubNode from "./HubNode.vue"
import type { HubNodeData } from "../business"
import { NodeContextMenu } from "#layers/core/app/features/shared"

const { data } = defineProps<NodeProps<HubNodeData>>()
const { stateStore } = useProjectStores()

const contextMenu = useTemplateRef("contextMenu")
</script>

<template>
  <HubNode :hub="data.hub" @contextmenu="contextMenu?.showContextMenu($event)">
    <NodeContextMenu
      ref="contextMenu"
      title="Hub"
      :subtitle="data.hub.id"
      :is-deletable="node => stateStore.isNodeDeletable(node)"
    />
  </HubNode>
</template>
