<script setup lang="ts">
import type { IDockviewPanelHeaderProps } from "dockview-vue"
import { Icon } from "@iconify/vue"

defineProps<{
  params: IDockviewPanelHeaderProps<{
    title: string
    customIcon?: string
    icon?: string
    closable?: boolean
  }>
}>()
</script>

<template>
  <div class="dv-default-tab">
    <Icon
      v-if="params.params.customIcon"
      class="mr-2"
      style="width: 16px; height: 16px"
      :icon="params.params.customIcon"
    />
    <VIcon v-else-if="params.params.icon" class="mr-2">{{ params.params.icon }}</VIcon>

    <div class="dv-default-tab-content">
      {{ params.params.title }}
    </div>

    <div v-if="params.params.closable" class="dv-default-tab-action" @click="params.api.close()">
      <svg
        height="11"
        width="11"
        viewBox="0 0 28 28"
        aria-hidden="false"
        focusable="false"
        class="dv-svg"
      >
        <path
          d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z"
        />
      </svg>
    </div>
  </div>
</template>
