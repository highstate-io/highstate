/** One exact npm selection; project selections are unique and sorted by packageName. */
export type SelectedLibraryPackage = {
  packageName: string
  version: string
}

/** Source hashes emitted by the library builder, keyed by package-relative implementation path. */
export type LibrarySourceManifest = {
  sourceHashes?: Record<string, number>
}

/** Snapshot source manifests and the direct package-version owner of each component or entity type. */
export type LibrarySnapshotSourceManifest = {
  packages: Record<string, LibrarySourceManifest>
  owners: Record<string, string>
}

/** Cached registry display metadata; npm remains authoritative. */
export type LibraryPackageMetadata = {
  description?: string
  homepage?: string
  license?: string
  engines?: Record<string, string>
}

/** Compatibility requirements captured with an immutable snapshot. */
export type LibraryCompatibility = {
  runtimeProtocolVersion: number
  packageFormatVersion: number
  bunVersion: string
  pulumiVersion: string
}
