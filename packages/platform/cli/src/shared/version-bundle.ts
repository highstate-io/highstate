import {
  fetchLatestVersion,
  fetchManifest,
  fetchPackageManifest,
  getDependencyRange,
  getReleaseGroupPackages,
} from "./npm-registry"

export type VersionBundle = {
  platformVersion: string
  stdlibVersion: string
  pulumiVersion: string
  platformPackages: string[]
  stdlibPackages: string[]
}

export type ResolveVersionBundleArgs = {
  platformVersion?: string
  stdlibVersion?: string
}

const platformSourcePackage = "@highstate/contract"
const stdlibSourcePackage = "@highstate/library"

export async function resolveVersionBundle(args: ResolveVersionBundleArgs): Promise<VersionBundle> {
  const platformVersion = normalizeProvidedVersion(args.platformVersion, "platform")
  const stdlibVersion = normalizeProvidedVersion(args.stdlibVersion, "stdlib")

  const resolvedPlatformVersion =
    platformVersion ?? (await fetchLatestVersion(platformSourcePackage))
  const resolvedStdlibVersion = stdlibVersion ?? (await fetchLatestVersion(stdlibSourcePackage))

  const [platformManifest, stdlibManifest, pulumiManifest] = await Promise.all([
    fetchManifest(platformSourcePackage, resolvedPlatformVersion),
    fetchManifest(stdlibSourcePackage, resolvedStdlibVersion),
    fetchManifest("@highstate/pulumi", resolvedPlatformVersion),
  ])
  const inferredPulumi = getDependencyRange(pulumiManifest, "@pulumi/pulumi")
  if (!inferredPulumi) {
    throw new Error(
      `Unable to infer "@pulumi/pulumi" version from "@highstate/pulumi@${resolvedPlatformVersion}"`,
    )
  }

  return {
    platformVersion: resolvedPlatformVersion,
    stdlibVersion: resolvedStdlibVersion,
    pulumiVersion: inferredPulumi,
    platformPackages: getReleaseGroupPackages(platformManifest, "platform"),
    stdlibPackages: getReleaseGroupPackages(stdlibManifest, "stdlib"),
  }
}

export async function resolvePreviewVersionBundle(args: {
  stable: Omit<VersionBundle, "platformPackages" | "stdlibPackages">
  packages: Record<string, string>
}): Promise<VersionBundle> {
  const [platformManifest, stdlibManifest] = await Promise.all([
    fetchReleaseGroupManifest(
      platformSourcePackage,
      args.stable.platformVersion,
      args.packages[platformSourcePackage],
    ),
    fetchReleaseGroupManifest(
      stdlibSourcePackage,
      args.stable.stdlibVersion,
      args.packages[stdlibSourcePackage],
    ),
  ])

  return {
    ...args.stable,
    platformPackages: getReleaseGroupPackages(platformManifest, "platform"),
    stdlibPackages: getReleaseGroupPackages(stdlibManifest, "stdlib"),
  }
}

async function fetchReleaseGroupManifest(
  packageName: string,
  version: string,
  previewUrl: string | undefined,
): Promise<import("./npm-registry").NpmRegistryManifest> {
  return previewUrl
    ? await fetchPackageManifest(previewUrl)
    : await fetchManifest(packageName, version)
}

function normalizeProvidedVersion(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Version flag "${label}" must not be empty`)
  }

  return trimmed
}
