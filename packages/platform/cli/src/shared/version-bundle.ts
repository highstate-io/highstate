import { fetchLatestVersion, fetchManifest, getDependencyRange } from "./npm-registry"

export type VersionBundle = {
  platformVersion: string
  stdlibVersion: string
  pulumiVersion: string
}

export type ResolveVersionBundleArgs = {
  platformVersion?: string
  stdlibVersion?: string
}

const platformSourcePackage = "@highstate/pulumi"
const stdlibSourcePackage = "@highstate/library"

export async function resolveVersionBundle(args: ResolveVersionBundleArgs): Promise<VersionBundle> {
  const platformVersion = normalizeProvidedVersion(args.platformVersion, "platform")
  const stdlibVersion = normalizeProvidedVersion(args.stdlibVersion, "stdlib")

  const resolvedPlatformVersion =
    platformVersion ?? (await fetchLatestVersion(platformSourcePackage))
  const resolvedStdlibVersion = stdlibVersion ?? (await fetchLatestVersion(stdlibSourcePackage))

  const platformManifest = await fetchManifest(platformSourcePackage, resolvedPlatformVersion)
  const inferredPulumi = getDependencyRange(platformManifest, "@pulumi/pulumi")
  if (!inferredPulumi) {
    throw new Error(
      `Unable to infer "@pulumi/pulumi" version from "${platformSourcePackage}@${resolvedPlatformVersion}"`,
    )
  }

  return {
    platformVersion: resolvedPlatformVersion,
    stdlibVersion: resolvedStdlibVersion,
    pulumiVersion: inferredPulumi,
  }
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
