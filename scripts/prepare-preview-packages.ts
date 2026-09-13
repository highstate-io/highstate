#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type DependencyField = "dependencies" | "optionalDependencies" | "peerDependencies"

export type PackageManifest = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const dependencyFields: DependencyField[] = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]

export function replaceWorkspaceDependencies(
  manifest: PackageManifest,
  workspaceVersions: ReadonlyMap<string, string>,
): PackageManifest {
  const result = structuredClone(manifest)

  for (const field of dependencyFields) {
    const dependencies = result[field]
    if (!dependencies) {
      continue
    }

    for (const [name, range] of Object.entries(dependencies)) {
      if (!range.startsWith("workspace:")) {
        continue
      }

      const version = workspaceVersions.get(name)
      if (!version) {
        throw new Error(`Unable to resolve workspace dependency "${name}"`)
      }

      dependencies[name] = version
    }
  }

  return result
}

async function preparePreviewPackages(
  root: string,
  trustedRoot: string,
  metadataPath: string,
): Promise<void> {
  const packages = JSON.parse(await readFile(metadataPath, "utf8")) as Array<{ path: string }>
  const workspaceVersions = await readWorkspaceVersions(trustedRoot)

  for (const pkg of packages) {
    const path = resolve(root, pkg.path, "package.json")
    const manifest = JSON.parse(await readFile(path, "utf8")) as PackageManifest
    const prepared = replaceWorkspaceDependencies(manifest, workspaceVersions)
    await writeFile(path, `${JSON.stringify(prepared, null, 2)}\n`)
  }
}

async function readWorkspaceVersions(root: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  const glob = new Bun.Glob("packages/**/package.json")

  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    const manifest = JSON.parse(await readFile(resolve(root, path), "utf8")) as PackageManifest
    if (manifest.name && manifest.version) {
      versions.set(manifest.name, manifest.version)
    }
  }

  return versions
}

if (import.meta.main) {
  const rootIndex = process.argv.indexOf("--root")
  const root = resolve(rootIndex === -1 ? "." : process.argv[rootIndex + 1])
  const trustedRootIndex = process.argv.indexOf("--trusted-root")
  const trustedRoot = resolve(trustedRootIndex === -1 ? root : process.argv[trustedRootIndex + 1])
  const metadataIndex = process.argv.indexOf("--metadata")
  const metadata = process.argv[metadataIndex + 1]
  if (metadataIndex === -1 || !metadata) {
    throw new Error("Missing --metadata")
  }

  await preparePreviewPackages(root, trustedRoot, resolve(metadata))
}
