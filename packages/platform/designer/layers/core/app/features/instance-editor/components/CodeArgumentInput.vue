<script setup lang="ts">
import { HighstateSignature, yamlValueSchema, type InstanceModel } from "@highstate/contract"
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import type { CodeEditorArgument } from "../business"
import ArgumentDescription from "./ArgumentDescription.vue"

const { argument, modelValue } = defineProps<{
  modelValue: unknown
  argument: CodeEditorArgument
  instance: InstanceModel
}>()

const currentValue = ref("")
if (typeof modelValue === "string") {
  currentValue.value = modelValue
} else {
  currentValue.value = yamlValueSchema.safeParse(modelValue)?.data?.value ?? ""
}

const emit = defineEmits<{
  (event: "update:model-value", value: unknown): void
}>()

const handleModelChange = (value: string) => {
  if (argument.kind === "code") {
    emit("update:model-value", value)
  } else {
    emit("update:model-value", {
      [HighstateSignature.Yaml]: true,
      value,
    })
  }

  currentValue.value = value
}
</script>

<template>
  <VExpansionPanel :title="argument.title" color="#2d2d2d" bg-color="#1e1e1e">
    <template #title>
      <div>{{ argument.title }}</div>
    </template>

    <template #text>
      <ArgumentDescription
        v-if="argument.description"
        :description="argument.description"
        class="mb-4"
      />

      <div class="editor">
        <VueMonacoEditor
          :value="currentValue"
          @update:value="handleModelChange"
          v-if="argument.kind === 'code'"
          theme="dark-plus"
          class="editor"
          :language="argument.language ?? 'text'"
          :options="{ tabSize: 2 }"
        />
        <VueMonacoEditor
          v-else
          :value="currentValue"
          @update:value="handleModelChange"
          theme="vs-dark"
          language="yaml"
          :path="`${instance.type}.${argument.name}`"
          :options="{ tabSize: 2 }"
        />
      </div>
    </template>
  </VExpansionPanel>
</template>

<style scoped>
.editor {
  width: 100%;
  height: 400px;
}
</style>
