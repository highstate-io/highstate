import type { PackageManagerName } from "nypm"
import type { PackageJson } from "pkg-types"
import { readFile } from "node:fs/promises"
import { resolvePackageJSON } from "pkg-types"
import { readPnpmWorkspace, resolvePnpmWorkspacePath } from "./pnpm-workspace"

export async function getProjectOverrideVersion(
  projectRoot: string,
  args: { packageManager: PackageManagerName; packageName: string },
): Promise<string | null> {
  const { packageManager, packageName } = args

  if (packageManager === "pnpm") {
    const path = resolvePnpmWorkspacePath(projectRoot)
    const workspace = await readPnpmWorkspace(path)
    return workspace.overrides?.[packageName] ?? null
  }

  const packageJsonPath = await resolvePackageJSON(projectRoot)
  const rawPackageJson = await readFile(packageJsonPath, "utf8")
  const packageJson = JSON.parse(rawPackageJson) as PackageJson

  if (packageManager === "npm") {
    const overrides = packageJson.overrides as Record<string, string> | undefined
    return overrides?.[packageName] ?? null
  }

  if (packageManager === "yarn") {
    const resolutions = packageJson.resolutions as Record<string, string> | undefined
    return resolutions?.[packageName] ?? null
  }

  return null
}

export async function getProjectPlatformVersion(
  projectRoot: string,
  args: { packageManager: PackageManagerName },
): Promise<string | null> {
  return await getProjectOverrideVersion(projectRoot, {
    packageManager: args.packageManager,
    packageName: "@highstate/pulumi",
  })
}

export async function getProjectPulumiSdkVersion(
  projectRoot: string,
  args: { packageManager: PackageManagerName },
): Promise<string | null> {
  return await getProjectOverrideVersion(projectRoot, {
    packageManager: args.packageManager,
    packageName: "@pulumi/pulumi",
  })
}
