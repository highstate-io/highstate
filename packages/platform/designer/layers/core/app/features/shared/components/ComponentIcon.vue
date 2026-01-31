<script setup lang="ts">
import type { ComponentModel } from "@highstate/contract"
import { Icon } from "@iconify/vue"

const { meta, size = 48 } = defineProps<{
  meta: ComponentModel["meta"]
  size?: number | string
}>()

const sizeCss = computed(() => (typeof size === "number" ? `${size}px` : size))
const primaryIcon = computed(() => meta.icon ?? "iconamoon:component")
</script>

<template>
  <div class="dual-icon" :style="{ '--component-icon-size': sizeCss }">
    <div class="dual-icon__square">
      <Icon :icon="primaryIcon" class="primary-icon" :color="meta.iconColor" />
      <Icon
        v-if="meta.secondaryIcon"
        :icon="meta.secondaryIcon"
        :color="meta.secondaryIconColor"
        class="secondary-icon"
      />
    </div>
  </div>
</template>

<style scoped>
.dual-icon {
  display: inline-block;
}

.dual-icon__square {
  position: relative;
  width: var(--component-icon-size, 48px);
  aspect-ratio: 1 / 1;
  display: grid;
  place-items: center;
}

.primary-icon {
  width: 83.333333%;
  height: 83.333333%;
  display: block;
}

.secondary-icon {
  width: 50%;
  height: 50%;
  position: absolute;
  bottom: 0;
  right: 0;
  display: block;
}
</style>
