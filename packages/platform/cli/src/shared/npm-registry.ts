import { gunzipSync } from "node:zlib"

export type NpmRegistryManifest = {
  name?: string
  version?: string
  peerDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  highstate?: {
    release?: {
      group?: string
      packages?: unknown
    }
  }
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

export async function fetchPackageManifest(url: string): Promise<NpmRegistryManifest> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch package manifest from "${url}" (HTTP ${response.status})`)
  }

  return readPackageManifestFromTarball(gunzipSync(await response.arrayBuffer()))
}

export function readPackageManifestFromTarball(tarball: Uint8Array): NpmRegistryManifest {
  for (let offset = 0; offset + 512 <= tarball.length; ) {
    const header = tarball.subarray(offset, offset + 512)
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || "0", 8)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Package tarball contains an invalid entry size")
    }

    const contentOffset = offset + 512
    if (contentOffset + size > tarball.length) {
      throw new Error("Package tarball contains a truncated entry")
    }
    if (path === "package/package.json") {
      const content = tarball.subarray(contentOffset, contentOffset + size)
      return JSON.parse(new TextDecoder().decode(content)) as NpmRegistryManifest
    }

    offset = contentOffset + Math.ceil(size / 512) * 512
  }

  throw new Error('Package tarball does not include "package/package.json"')
}

function readTarString(header: Uint8Array, offset: number, length: number): string {
  const value = header.subarray(offset, offset + length)
  const end = value.indexOf(0)
  return new TextDecoder().decode(end === -1 ? value : value.subarray(0, end))
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

export function getReleaseGroupPackages(
  manifest: NpmRegistryManifest,
  expectedGroup: string,
): string[] {
  const release = manifest.highstate?.release
  if (
    release?.group !== expectedGroup ||
    !Array.isArray(release.packages) ||
    release.packages.length === 0 ||
    !release.packages.every(
      name =>
        typeof name === "string" &&
        (name === "create-highstate" || /^@highstate\/[a-z0-9.-]+$/.test(name)),
    )
  ) {
    throw new Error(
      `Package "${manifest.name ?? "unknown"}@${manifest.version ?? "unknown"}" does not include valid Highstate release group "${expectedGroup}" metadata`,
    )
  }

  return release.packages
}
