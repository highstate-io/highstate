<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import ArgumentDescription from "./ArgumentDescription.vue"
import type { PlainEditorArgument } from "../business"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = defineModel<any>()

const { argument, isSecret } = defineProps<{
  argument: PlainEditorArgument
  instance: InstanceModel
  isSecret?: boolean
}>()

if (model.value === undefined && argument.default !== undefined) {
  model.value = argument.default
}

const showSecret = ref(false)

const textFieldType = computed(() => {
  if (isSecret) {
    return showSecret.value ? "text" : "password"
  }

  return "text"
})

const placeholder = computed(() => {
  if (argument.default != null) {
    return String(argument.default)
  }

  return ""
})
</script>

<template>
  <div>
    <VTextField
      v-if="argument.kind === 'input' && argument.type === 'string'"
      v-model="model"
      :label="argument.title"
      :placeholder="placeholder"
      :type="textFieldType"
      variant="outlined"
      density="compact"
      hide-details
    >
      <template #append-inner>
        <VIcon v-if="isSecret" @click="showSecret = !showSecret">
          {{ showSecret ? "mdi-eye-off" : "mdi-eye" }}
        </VIcon>
      </template>
    </VTextField>

    <VNumberInput
      v-else-if="
        argument.kind === 'input' && (argument.type === 'number' || argument.type === 'integer')
      "
      v-model="model"
      :label="argument.title"
      :placeholder="placeholder"
      variant="outlined"
      density="compact"
      hide-details
    >
      <template #append-inner>
        <VIcon v-if="isSecret" @click="showSecret = !showSecret">
          {{ showSecret ? "mdi-eye-off" : "mdi-eye" }}
        </VIcon>
      </template>
    </VNumberInput>

    <VCombobox
      v-else-if="argument.kind === 'combobox'"
      v-model="model"
      :label="argument.title"
      :placeholder="placeholder"
      variant="outlined"
      density="compact"
      multiple
      chips
      hide-details
    />

    <VSelect
      v-else-if="argument.kind === 'select'"
      v-model="model"
      :label="argument.title"
      :placeholder="placeholder"
      :items="argument.enum"
      variant="outlined"
      density="compact"
      :multiple="argument.multiple"
      hide-details
    />

    <VCheckbox v-else v-model="model" :label="argument.title" density="compact" hide-details />

    <ArgumentDescription
      v-if="argument.description"
      class="mt-2"
      :description="argument.description"
    />
  </div>
</template>
