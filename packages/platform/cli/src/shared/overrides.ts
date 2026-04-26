import type { VersionBundle } from "./version-bundle"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { writeJsonFile } from "./package-json"
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
  overrides: Overrides
  projectRoot: string
}

export async function applyOverrides(args: ApplyOverridesArgs): Promise<void> {
  const { overrides, projectRoot } = args

  const packageJsonPath = await resolvePackageJSON(projectRoot)
  const packageJson = await readPackageJSON(projectRoot)

  await writeJsonFile(packageJsonPath, {
    ...packageJson,
    overrides,
  })
}
