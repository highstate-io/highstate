<script setup lang="ts">
import type { InstanceModel } from "@highstate/contract"
import type { PlainEditorArgument } from "../business"
import ArgumentDescription from "./ArgumentDescription.vue"

// biome-ignore lint/suspicious/noExplicitAny: Vuetify inputs accept different scalar models selected by the argument schema
const model = defineModel<any>()

const { argument, isSecret } = defineProps<{
  argument: PlainEditorArgument
  instance: InstanceModel
  isSecret?: boolean
  readonly?: boolean
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
      :readonly="readonly"
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
      :readonly="readonly"
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
      :disabled="readonly"
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
      :disabled="readonly"
    />

    <VCheckbox
      v-else
      v-model="model"
      :label="argument.title"
      density="compact"
      hide-details
      :disabled="readonly"
    />

    <ArgumentDescription
      v-if="argument.description"
      class="mt-2"
      :description="argument.description"
    />
  </div>
</template>
