<script setup lang="ts">
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import { stringify } from "yaml"

const {
  title,
  data,
  language = "yaml",
  height = "400px",
  icon = "mdi-code-json",
} = defineProps<{
  title: string
  data: unknown
  language?: string
  height?: string
  icon?: string
}>()

const formattedCode = computed(() => {
  if (language === "json") {
    return JSON.stringify(data, null, 2)
  }

  return stringify(data, null, 2)
})
</script>

<template>
  <VExpansionPanel color="#2d2d2d" bg-color="#1e1e1e">
    <template #title>
      <div class="d-flex align-center">
        <VIcon class="mr-2">{{ icon }}</VIcon>
        {{ title }}
      </div>
    </template>

    <template #text>
      <div class="editor" :style="{ height }">
        <VueMonacoEditor
          :value="formattedCode"
          :language="language"
          theme="vs-dark"
          class="editor"
          :options="{
            readOnly: true,
            tabSize: 2,
            wordWrap: 'on',
            folding: true,
            automaticLayout: true,
          }"
        />
      </div>
    </template>
  </VExpansionPanel>
</template>

<style scoped>
.editor {
  width: 100%;
  border-radius: 0;
  overflow: hidden;
}
</style>
