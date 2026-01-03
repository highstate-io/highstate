export type NpmRegistryManifest = {
  name?: string
  version?: string
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export type NpmRegistryPackument = {
  "dist-tags"?: {
    latest?: string
  }
  versions?: Record<string, NpmRegistryManifest>
}

export async function fetchNpmPackument(packageName: string): Promise<NpmRegistryPackument> {
  const encoded = encodeURIComponent(packageName)
  const url = `https://registry.npmjs.org/${encoded}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch package "${packageName}" from NPM registry (HTTP ${response.status})`,
    )
  }

  return (await response.json()) as NpmRegistryPackument
}

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const packument = await fetchNpmPackument(packageName)
  const latest = packument["dist-tags"]?.latest
  if (!latest) {
    throw new Error(
      `NPM registry response for package "${packageName}" does not include "dist-tags.latest"`,
    )
  }

  return latest
}

export async function fetchManifest(
  packageName: string,
  version: string,
): Promise<NpmRegistryManifest> {
  const packument = await fetchNpmPackument(packageName)
  const manifest = packument.versions?.[version]
  if (!manifest) {
    throw new Error(
      `NPM registry response for package "${packageName}" does not include version "${version}"`,
    )
  }

  return manifest
}

export function getDependencyRange(
  manifest: NpmRegistryManifest,
  dependencyName: string,
): string | null {
  return (
    manifest.peerDependencies?.[dependencyName] ??
    manifest.dependencies?.[dependencyName] ??
    manifest.optionalDependencies?.[dependencyName] ??
    null
  )
}
