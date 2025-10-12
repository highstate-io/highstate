<script setup lang="ts">
import type { ComponentModel } from "@highstate/contract"
import { Icon } from "@iconify/vue"

const { meta } = defineProps<{
  meta: ComponentModel["meta"]
}>()

const primaryIcon = computed(() => meta.icon ?? "iconamoon:component")
</script>

<template>
  <div class="dual-icon">
    <Icon :icon="primaryIcon" class="primary-icon" :color="meta.iconColor" />
    <Icon
      v-if="meta.secondaryIcon"
      :icon="meta.secondaryIcon"
      :color="meta.secondaryIconColor"
      class="secondary-icon"
    />
  </div>
</template>

<style scoped>
.dual-icon {
  position: relative;
  width: 48px;
  height: 48px;
}

.primary-icon {
  width: 40px;
  height: 40px;
}

.secondary-icon {
  width: 24px;
  height: 24px;
  position: absolute;
  bottom: 0;
  right: 0;
}
</style>
