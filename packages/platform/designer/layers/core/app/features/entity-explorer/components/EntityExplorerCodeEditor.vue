<script setup lang="ts">
import { VueMonacoEditor } from "@guolao/vue-monaco-editor"
import type * as monaco from "monaco-editor"

import {
  createReadOnlyEditorOptions,
  foldEntityYamlByDefault,
  foldNestedBlocksByDefault,
  formatReconstructedEntityValueYaml,
  ensureEntitySnapshotCodeLensNavigation,
  type OutputReferencedEntitySnapshot,
  updateEntitySnapshotCodeLenses,
  updateEntitySnapshotFoldingRegions,
} from "../business"

const {
  entity,
  projectId,
  language = "yaml",
  theme = "dark-plus",
  height = "100%",
  foldNestedByDefault = true,
  options,
} = defineProps<{
  entity: OutputReferencedEntitySnapshot
  projectId?: string
  language?: string
  theme?: string
  height?: string
  foldNestedByDefault?: boolean
  options?: monaco.editor.IStandaloneEditorConstructionOptions
}>()

const formatted = computed(() => {
  return formatReconstructedEntityValueYaml(entity.content)
})

const value = computed(() => {
  return formatted.value.yaml
})

const path = computed(() => {
  return `entity://${entity.snapshotId}`
})

const editorOptions = computed(() => {
  return {
    ...createReadOnlyEditorOptions(),
    ...(options ?? {}),
  } satisfies monaco.editor.IStandaloneEditorConstructionOptions
})

const router = useRouter()
ensureEntitySnapshotCodeLensNavigation(router)

const editorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)

async function applyDefaultFolding() {
  if (!foldNestedByDefault || !editorRef.value) {
    return
  }

  if (language === "yaml") {
    updateEntitySnapshotFoldingRegions(entity.snapshotId, formatted.value.regions)
    updateEntitySnapshotCodeLenses({
      snapshotId: entity.snapshotId,
      projectId,
      links: formatted.value.links,
    })
    await foldEntityYamlByDefault(editorRef.value, formatted.value.regions)
    return
  }

  await foldNestedBlocksByDefault(editorRef.value)
}

const handleMount = async (
  editor: monaco.editor.IStandaloneCodeEditor,
  _monacoInstance?: typeof import("monaco-editor"),
) => {
  editorRef.value = editor

  await nextTick()
  await applyDefaultFolding()
}

watch(
  () => value,
  async () => {
    await nextTick()
    await applyDefaultFolding()
  },
)
</script>

<template>
  <div :style="{ height }">
    <VueMonacoEditor
      :value="value"
      :language="language"
      :theme="theme"
      :path="path"
      :options="editorOptions"
      :style="{ height: '100%' }"
      @mount="handleMount"
    />
  </div>
</template>
