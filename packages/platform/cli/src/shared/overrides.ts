import type { VersionBundle } from "./version-bundle"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { writeJsonFile } from "./package-json"

export type Overrides = Record<string, string>

export function buildOverrides(bundle: VersionBundle): Overrides {
  const platform = Object.fromEntries(
    bundle.platformPackages.map(name => [name, bundle.platformVersion]),
  )
  const stdlib = Object.fromEntries(bundle.stdlibPackages.map(name => [name, bundle.stdlibVersion]))

  const merged: Overrides = {
    ...platform,
    ...stdlib,
    "@pulumi/pulumi": bundle.pulumiVersion,
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
