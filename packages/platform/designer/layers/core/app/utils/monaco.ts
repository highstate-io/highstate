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

type FoldingRange = monaco.languages.FoldingRange
type CodeLens = monaco.languages.CodeLens

const snapshotFoldingRegionsByUri = new Map<string, FoldingRange[]>()
const snapshotCodeLensesByUri = new Map<string, CodeLens[]>()

const toSnapshotUri = (snapshotId: string): string => {
  return `entity://${snapshotId}`
}

export function updateSnapshotRegions(snapshotId: string, ranges: FoldingRange[]): void {
  snapshotFoldingRegionsByUri.set(toSnapshotUri(snapshotId), ranges)
}

export function clearSnapshotRegions(snapshotId: string): void {
  snapshotFoldingRegionsByUri.delete(toSnapshotUri(snapshotId))
}

export const INVOKE_HIGHSTATE_ACTION_COMMAND_ID = "invoke-highstate-action"

export type HighstateAction = {
  kind: string
  payload?: unknown
}

const highstateActions = new Map<string, (payload: unknown) => void>()

const highstateActionListeners = new Set<(action: HighstateAction) => void>()

export function onHighstateActionInvoked(listener: (action: HighstateAction) => void): () => void {
  highstateActionListeners.add(listener)

  return () => {
    highstateActionListeners.delete(listener)
  }
}

export function registerHighstateAction(
  kind: string,
  handler: (payload: unknown) => void,
): void {
  highstateActions.set(kind, handler)
}

export function unregisterHighstateAction(kind: string): void {
  highstateActions.delete(kind)
}

export function updateSnapshotCodeLenses(snapshotId: string, lenses: CodeLens[]): void {
  snapshotCodeLensesByUri.set(toSnapshotUri(snapshotId), lenses)
}

export function clearSnapshotCodeLenses(snapshotId: string): void {
  snapshotCodeLensesByUri.delete(toSnapshotUri(snapshotId))
}

loader.config({ monaco })

monaco.languages.registerFoldingRangeProvider("yaml", {
  provideFoldingRanges: (model, _context, _token) => {
    return snapshotFoldingRegionsByUri.get(model.uri.toString()) ?? []
  },
})

monaco.editor.registerCommand(INVOKE_HIGHSTATE_ACTION_COMMAND_ID, (_accessor, detail: unknown) => {
  if (!detail || typeof detail !== "object") {
    return
  }

  const record = detail as Partial<HighstateAction>
  if (typeof record.kind !== "string" || record.kind.length === 0) {
    return
  }

  for (const listener of highstateActionListeners) {
    try {
      listener({ kind: record.kind, payload: record.payload })
    } catch {
      // ignore listener errors
    }
  }

  const handler = highstateActions.get(record.kind)
  if (!handler) {
    return
  }

  handler(record.payload)
})

monaco.languages.registerCodeLensProvider("yaml", {
  provideCodeLenses: model => {
    return {
      lenses: snapshotCodeLensesByUri.get(model.uri.toString()) ?? [],
      dispose: () => {},
    }
  },
  resolveCodeLens: (_model, codeLens) => {
    return codeLens
  },
})

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
