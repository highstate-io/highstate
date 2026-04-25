import * as monaco from "monaco-editor"

import {
  INVOKE_HIGHSTATE_ACTION_COMMAND_ID,
  updateSnapshotCodeLenses,
  updateSnapshotRegions,
} from "#layers/core/app/utils/monaco"
import type { EntitySnapshotLink, FoldingRegion } from "./reconstruction"

export type ReadOnlyEditorOptions = monaco.editor.IStandaloneEditorConstructionOptions

export function createReadOnlyEditorOptions(): ReadOnlyEditorOptions {
  return {
    readOnly: true,
    minimap: { enabled: false },
    wordWrap: "on",
    folding: true,
    foldingStrategy: "auto",
    automaticLayout: true,
    scrollBeyondLastLine: false,
  }
}

const YAML_FOLD_KIND =  monaco.languages.FoldingRangeKind.Comment

export function updateEntitySnapshotFoldingRegions(
  snapshotId: string,
  regions: FoldingRegion[],
): void {
  if (!snapshotId) {
    return
  }

  updateSnapshotRegions(
    snapshotId,
    regions
      .filter(region => region.end > region.start)
      .map(region => ({ start: region.start, end: region.end, kind: YAML_FOLD_KIND })),
  )
}

export function updateEntitySnapshotCodeLenses(options: {
  snapshotId: string
  projectId?: string
  links: EntitySnapshotLink[]
}): void {
  if (!options.projectId) {
    updateSnapshotCodeLenses(options.snapshotId, [])
    return
  }

  const lenses: monaco.languages.CodeLens[] = options.links.map(link => {
    return {
      range: {
        startLineNumber: link.line,
        startColumn: 1,
        endLineNumber: link.line,
        endColumn: 1,
      },
      command: {
        id: INVOKE_HIGHSTATE_ACTION_COMMAND_ID,
        title: "Open Entity",
        arguments: [
          {
            kind: "openEntitySnapshot",
            payload: {
              projectId: options.projectId,
              snapshotId: link.snapshotId,
            },
          },
        ],
      },
    }
  })

  updateSnapshotCodeLenses(options.snapshotId, lenses)
}

async function tryRunEditorAction(
  editor: monaco.editor.IStandaloneCodeEditor,
  id: string,
  args?: unknown,
) {
  try {
    const action = editor.getAction(id)
    if (!action) {
      console.warn(`[entity-explorer] editor action not found: ${id}`)
      return false
    }

    await action.run(args)
    return true
  } catch (error) {
    console.warn(`[entity-explorer] editor action failed: ${id}`, error)
    return false
  }
}

/**
 * Folds nested blocks while keeping the top-level visible.
 *
 * It prefers folding by level (level 2+). If the action is not available,
 * it falls back to folding everything.
 */
export async function foldNestedBlocksByDefault(
  editor: monaco.editor.IStandaloneCodeEditor,
): Promise<void> {
  const foldedByLevel = await tryRunEditorAction(editor, "editor.foldLevel2")
  if (foldedByLevel) {
    return
  }

  await tryRunEditorAction(editor, "editor.foldAll")
}

/**
 * Folds YAML with all nested regions collapsed by default.
 *
 * It folds levels 2 through 7 explicitly, leaving level 1 expanded.
 */
export async function foldEntityYamlByDefault(
  editor: monaco.editor.IStandaloneCodeEditor,
): Promise<void> {
  for (let level = 2; level <= 7; level++) {
    await tryRunEditorAction(editor, `editor.foldLevel${level}`)
  }
}
