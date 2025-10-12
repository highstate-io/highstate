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

let initialValue: string
if (typeof modelValue === "string") {
  initialValue = modelValue
} else {
  initialValue = yamlValueSchema.safeParse(modelValue)?.data?.value ?? ""
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
}
</script>

<template>
  <VExpansionPanel :title="argument.title" color="#2d2d2d" bg-color="#1e1e1e">
    <template #title>
      <div>{{ argument.title }}</div>
      <ArgumentDescription v-if="argument.description" :description="argument.description" />
    </template>

    <template #text>
      <div class="editor">
        <VueMonacoEditor
          :value="initialValue"
          @update:value="handleModelChange"
          v-if="argument.kind === 'code'"
          theme="dark-plus"
          class="editor"
          :language="argument.language ?? 'text'"
          :options="{ tabSize: 2 }"
        />
        <VueMonacoEditor
          v-else
          :value="initialValue"
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
