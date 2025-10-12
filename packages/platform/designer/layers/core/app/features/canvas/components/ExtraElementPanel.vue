<script setup lang="ts">
import { setHubDragData } from "#layers/core/app/features/shared"
import HubCard from "./HubCard.vue"

const onDragStart = (event: DragEvent) => {
  setHubDragData(event.dataTransfer!)
}
</script>

<template>
  <VCard>
    <div draggable="true" style="cursor: grab" @dragstart="onDragStart">
      <HubCard />
    </div>
  </VCard>
</template>
