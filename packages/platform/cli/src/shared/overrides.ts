import type { PackageManagerName } from "nypm"
import type { VersionBundle } from "./version-bundle"
import { access } from "node:fs/promises"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { writeJsonFile } from "./package-json"
import { readPnpmWorkspace, resolvePnpmWorkspacePath, writePnpmWorkspace } from "./pnpm-workspace"
import { PLATFORM_PACKAGES, PULUMI_PACKAGES, STDLIB_PACKAGES } from "./version-sets"

export type Overrides = Record<string, string>

export function buildOverrides(bundle: VersionBundle): Overrides {
  const platform = Object.fromEntries(PLATFORM_PACKAGES.map(name => [name, bundle.platformVersion]))
  const stdlib = Object.fromEntries(STDLIB_PACKAGES.map(name => [name, bundle.stdlibVersion]))
  const pulumi = Object.fromEntries(PULUMI_PACKAGES.map(name => [name, bundle.pulumiVersion]))

  const merged: Overrides = {
    ...platform,
    ...stdlib,
    ...pulumi,
  }

  return merged
}

export type ApplyOverridesArgs = {
  packageManager: PackageManagerName
  overrides: Overrides
  projectRoot: string
}

export async function applyOverrides(args: ApplyOverridesArgs): Promise<void> {
  const { packageManager, overrides, projectRoot } = args

  if (packageManager === "pnpm") {
    const pnpmWorkspacePath = resolvePnpmWorkspacePath(projectRoot)

    try {
      await access(pnpmWorkspacePath)
    } catch {
      throw new Error(`PNPM workspace file is missing: "${pnpmWorkspacePath}"`)
    }

    const workspace = await readPnpmWorkspace(pnpmWorkspacePath)
    const nextWorkspace = {
      ...workspace,
      overrides,
    }

    await writePnpmWorkspace(pnpmWorkspacePath, nextWorkspace)
    return
  }

  const packageJsonPath = await resolvePackageJSON(projectRoot)
  const packageJson = await readPackageJSON(projectRoot)

  if (packageManager === "npm") {
    await writeJsonFile(packageJsonPath, {
      ...packageJson,
      overrides,
    })
    return
  }

  if (packageManager === "yarn") {
    await writeJsonFile(packageJsonPath, {
      ...packageJson,
      resolutions: overrides,
    })
    return
  }

  await writeJsonFile(packageJsonPath, packageJson)
}
