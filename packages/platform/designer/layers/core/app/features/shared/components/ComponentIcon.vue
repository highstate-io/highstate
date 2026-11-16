<script setup lang="ts">
import { Icon } from "@iconify/vue"

const { meta, size = 48 } = defineProps<{
  meta: {
    icon?: string
    iconColor?: string
    secondaryIcon?: string
    secondaryIconColor?: string
  }
  size?: number | string
}>()

const sizeCss = computed(() => (typeof size === "number" ? `${size}px` : size))
const primaryIcon = computed(() => meta.icon ?? "iconamoon:component")

const materialPrimaryIcon = computed(() =>
  primaryIcon.value.startsWith("mdi:") ? primaryIcon.value.replace("mdi:", "mdi-") : undefined,
)

const materialSecondaryIcon = computed(() =>
  meta.secondaryIcon?.startsWith("mdi:") ? meta.secondaryIcon.replace("mdi:", "mdi-") : undefined,
)
</script>

<template>
  <div class="dual-icon" :style="{ '--component-icon-size': sizeCss }">
    <div class="dual-icon__square">
      <VIcon
        v-if="materialPrimaryIcon"
        :icon="materialPrimaryIcon"
        class="primary-icon"
        :color="meta.iconColor"
      />
      <Icon v-else :icon="primaryIcon" class="primary-icon" :color="meta.iconColor" />
      <VIcon
        v-if="materialSecondaryIcon"
        :icon="materialSecondaryIcon"
        :color="meta.secondaryIconColor"
        class="secondary-icon"
      />
      <Icon
        v-else-if="meta.secondaryIcon"
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
  font-size: calc(var(--component-icon-size, 48px) * 0.83333333);
  width: 83.333333%;
  height: 83.333333%;
  display: block;
}

.secondary-icon {
  font-size: calc(var(--component-icon-size, 48px) * 0.5);
  width: 50%;
  height: 50%;
  position: absolute;
  bottom: 0;
  right: 0;
  display: block;
}
</style>
