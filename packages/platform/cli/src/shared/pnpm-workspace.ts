import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parse, stringify } from "yaml"

export type PnpmWorkspace = {
  packages?: string[]
  overrides?: Record<string, string>
}

export function resolvePnpmWorkspacePath(projectRoot: string): string {
  return resolve(projectRoot, "pnpm-workspace.yaml")
}

export async function readPnpmWorkspace(filePath: string): Promise<PnpmWorkspace> {
  const raw = await readFile(filePath, "utf8")
  const parsed = parse(raw)

  if (typeof parsed !== "object" || parsed === null) {
    return {}
  }

  return parsed as PnpmWorkspace
}

export async function writePnpmWorkspace(
  filePath: string,
  workspace: PnpmWorkspace,
): Promise<void> {
  const raw = stringify(workspace)

  await writeFile(filePath, raw, "utf8")
}
