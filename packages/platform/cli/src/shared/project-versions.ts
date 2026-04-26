import type { PackageJson } from "pkg-types"
import { readFile } from "node:fs/promises"
import { resolvePackageJSON } from "pkg-types"

export async function getProjectOverrideVersion(
  projectRoot: string,
  args: { packageName: string },
): Promise<string | null> {
  const { packageName } = args

  const packageJsonPath = await resolvePackageJSON(projectRoot)
  const rawPackageJson = await readFile(packageJsonPath, "utf8")
  const packageJson = JSON.parse(rawPackageJson) as PackageJson

  const overrides = packageJson.overrides as Record<string, string> | undefined
  return overrides?.[packageName] ?? null
}

export async function getProjectPlatformVersion(projectRoot: string): Promise<string | null> {
  return await getProjectOverrideVersion(projectRoot, {
    packageName: "@highstate/pulumi",
  })
}

export async function getProjectPulumiSdkVersion(projectRoot: string): Promise<string | null> {
  return await getProjectOverrideVersion(projectRoot, {
    packageName: "@pulumi/pulumi",
  })
}
