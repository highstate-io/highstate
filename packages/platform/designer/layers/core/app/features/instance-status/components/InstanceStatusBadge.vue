<script setup lang="ts">
import {
  type InstanceState,
  type Operation,
  type ValidationOutput,
} from "@highstate/backend/shared"
import { createStatusPanelTabs } from "../business"
import { GenericIcon } from "#layers/core/app/features/shared"
import { GenericTerminal } from "#layers/core/app/features/terminals"
import InstanceStatusLogsTab from "./InstanceStatusLogsTab.vue"

const { state, operation, expectedInputHash, validationOutput } = defineProps<{
  state?: InstanceState
  operation?: Operation
  expectedInputHash?: number
  validationOutput?: ValidationOutput
}>()

const tabs = computed(() =>
  createStatusPanelTabs(state, operation, expectedInputHash, validationOutput),
)
const badgeTab = computed(() => tabs.value.find(tab => tab.important) ?? tabs.value[0])

const currentTabName = ref<string>(badgeTab.value.name)
const panelOpened = ref(false)

watch(
  [badgeTab, state],
  () => {
    if (panelOpened.value) {
      return
    }

    // show the most left tab by default
    currentTabName.value = badgeTab.value.name
  },
  { immediate: true },
)

const getColorClass = (color: string) => {
  if (color.startsWith("#")) {
    return {}
  }

  return { [`text-${color}`]: true }
}

const getColorStyle = (color: string) => {
  if (color.startsWith("#")) {
    return { color }
  }

  return {}
}

const showProgress = computed(() => {
  return badgeTab.value.progress !== undefined && badgeTab.value.progress < 100
})
</script>

<template>
  <VMenu v-model="panelOpened" open-on-hover :close-on-content-click="false" location="end">
    <template #activator="{ props }">
      <VChip
        v-bind="props"
        :color="badgeTab.color"
        style="width: 44px"
        :style="{ padding: showProgress ? '0' : undefined }"
        class="status-chip"
      >
        <div
          v-if="showProgress"
          class="d-flex align-center justify-center"
          style="width: 100%; height: 100%"
        >
          {{ badgeTab.progress }}%
        </div>
        <GenericIcon
          v-else
          :size="20"
          :icon="`mdi-${badgeTab.icon}`"
          :custom-icon="badgeTab.customIcon"
        />
      </VChip>
    </template>

    <VSheet color="black">
      <VTabs v-model="currentTabName" :items="tabs">
        <template #tab="{ item }">
          <VTab :value="item.name">
            <GenericIcon
              :size="22"
              :icon="`mdi-${item.icon}`"
              :custom-icon="item.customIcon"
              :color="item.color"
              class="mr-2"
            />

            <div class="d-flex flex-column">
              <div
                class="font-weight-bold text-start"
                :class="getColorClass(item.color)"
                :style="getColorStyle(item.color)"
              >
                {{ item.title }}
              </div>
              <div
                class="text-caption font-weight-bold text-start"
                :class="getColorClass(item.color)"
                :style="getColorStyle(item.color)"
              >
                {{ item.status }}
              </div>
            </div>
          </VTab>
        </template>

        <template #item="{ item }">
          <VTabsWindowItem :value="item.name">
            <GenericTerminal
              v-if="!item.logs"
              class="mt-2 mb-2"
              :columns="80"
              :rows="24"
              :content="item.message"
            />
            <InstanceStatusLogsTab
              v-else-if="state?.lastOperationState?.operationId"
              :key="state.lastOperationState.operationId"
              :instance-id="state.id"
              :operationState="state.lastOperationState"
            />
          </VTabsWindowItem>
        </template>
      </VTabs>
    </VSheet>
  </VMenu>
</template>

<style scoped>
.status-chip > :deep(div) {
  width: 100%;
  height: 100%;
}
</style>
