import * as monaco from "monaco-editor"
import { loader } from "@guolao/vue-monaco-editor"
import YamlWorker from "#layers/core/app/workers/yaml.worker?worker"
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import { configureMonacoYaml, type SchemasSettings } from "monaco-yaml"
import type { z } from "@highstate/contract"
import { shikiToMonaco } from "@shikijs/monaco"
import { createHighlighter } from "shiki"

const highlighter = await createHighlighter({
  themes: ["dark-plus"],
  langs: ["nix"],
})

monaco.languages.register({ id: "nix" })
monaco.languages.setLanguageConfiguration("nix", {
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
})

shikiToMonaco(highlighter, monaco)

self.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case "yaml":
        return new YamlWorker()
      default:
        return new EditorWorker()
    }
  },
}

const schemas = new Map<string, SchemasSettings>()
const monacoYaml = configureMonacoYaml(monaco, {})

loader.config({ monaco })

export function updateComponentSchema(
  componentType: string,
  name: string,
  schema: z.core.JSONSchema.BaseSchema,
): void {
  schemas.set(`${componentType}.${name}`, {
    fileMatch: [`${componentType}.${name}`],
    uri: `library://${componentType}/${name}`,
    schema,
  })

  monacoYaml.update({ schemas: Array.from(schemas.values()) })
}
