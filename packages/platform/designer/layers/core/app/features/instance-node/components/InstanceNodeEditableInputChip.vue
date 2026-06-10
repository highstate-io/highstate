<script setup lang="ts">
import type { ValidConnectionFunc } from "@vue-flow/core"
import { camelCaseToHumanReadable } from "@highstate/contract"
import InstanceNodeIOSideHandle from "./InstanceNodeIOSideHandle.vue"

const {
  name,
  side,
  reservedLabelWidthCh,
  chipBackgroundColor,
  chipTextColor,
  isValidConnection,
  renameInput,
} = defineProps<{
  name: string
  side: "left" | "right"
  reservedLabelWidthCh: number
  chipBackgroundColor: string
  chipTextColor: string
  isValidConnection?: ValidConnectionFunc
  renameInput: (oldName: string, newName: string) => Promise<void>
}>()

const editing = ref(false)
const renameInputValue = ref("")
const renaming = ref(false)
const renameError = ref<string>()

const renameInputWidth = computed(() => {
  const length = renameInputValue.value.trim().length || name.length || 8
  return `${Math.max(length, 6)}ch`
})

const startRename = () => {
  editing.value = true
  renameInputValue.value = name
  renameError.value = undefined
}

const cancelRename = () => {
  editing.value = false
  renameInputValue.value = ""
  renameError.value = undefined
}

const saveRename = async () => {
  const nextName = renameInputValue.value.trim()

  renaming.value = true

  try {
    await renameInput(name, nextName)
    cancelRename()
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : "Failed to rename input"
  } finally {
    renaming.value = false
  }
}
</script>

<template>
  <VChip
    :style="{
      '--label-column-width': `${reservedLabelWidthCh}ch`,
      backgroundColor: chipBackgroundColor,
      color: chipTextColor,
    }"
    text-color="white"
    class="rounded handle-chip rename-chip"
  >
    <div class="rename-chip-content">
      <template v-if="editing">
        <input
          v-model="renameInputValue"
          class="rename-input"
          :style="{ width: renameInputWidth }"
          :disabled="renaming"
          type="text"
          @keydown.enter.stop.prevent="saveRename"
          @keydown.esc.stop.prevent="cancelRename"
        />
        <div class="rename-actions">
          <VBtn
            variant="text"
            icon="mdi-check"
            size="x-small"
            class="rename-action-btn"
            :loading="renaming"
            @mousedown.stop
            @click.stop="saveRename"
          />
          <VBtn
            variant="text"
            icon="mdi-close"
            size="x-small"
            class="rename-action-btn"
            :disabled="renaming"
            @mousedown.stop
            @click.stop="cancelRename"
          />
        </div>
      </template>
      <template v-else>
        <span class="rename-label">{{ camelCaseToHumanReadable(name) }}</span>
        <div class="rename-actions">
          <VBtn
            variant="text"
            icon="mdi-check"
            size="x-small"
            class="rename-action-btn rename-action-placeholder"
            tabindex="-1"
            aria-hidden="true"
            disabled
          />
          <VBtn
            variant="text"
            icon="mdi-pencil"
            size="x-small"
            class="rename-action-btn"
            @mousedown.stop
            @click.stop="startRename"
          />
        </div>
      </template>
    </div>

    <InstanceNodeIOSideHandle
      :name="name"
      :side="side"
      :is-valid-connection="isValidConnection"
      :handle-color="chipBackgroundColor"
      compact
    />
  </VChip>

  <div v-if="editing && renameError" class="rename-error">
    {{ renameError }}
  </div>
</template>

<style scoped>
.handle-chip {
  position: relative;
  overflow: visible;
}

.rename-chip {
  min-height: 32px;
  width: 100%;
  max-width: 100%;
}

.rename-chip-content {
  display: grid;
  grid-template-columns: minmax(var(--label-column-width), 1fr) auto;
  align-items: center;
  column-gap: 6px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.rename-label {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0;
  white-space: nowrap;
}

.rename-input {
  appearance: none;
  background: transparent;
  border: 0;
  box-shadow: none;
  color: inherit;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 20px;
  margin: 0;
  min-height: 22px;
  min-width: 8ch;
  outline: none;
  padding: 0;
  width: auto;
}

.rename-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  width: 44px;
}

.rename-action-btn {
  min-width: 20px;
  width: 20px;
  height: 20px;
  padding: 0;
}

.rename-action-placeholder {
  visibility: hidden;
  pointer-events: none;
}

.rename-error {
  color: rgb(var(--v-theme-error));
  font-size: 11px;
  margin: -4px 0 0 6px;
}
</style>
