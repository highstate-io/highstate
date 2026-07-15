import { readFile } from "node:fs/promises"
import { Command, Option } from "clipanion"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import semver from "semver"
import {
  applyOverrides,
  buildOverrides,
  fetchManifest,
  fetchNpmPackument,
  getDependencyRange,
  getProjectPlatformVersion,
  logger,
  resolveVersionBundle,
  writeJsonFile,
} from "../shared"

export class UpdateCommand extends Command {
  static paths = [["update"]]

  static usage = Command.Usage({
    description: "Updates version overrides in an existing Highstate project.",
  })

  platformVersion = Option.String("--platform-version", {
    description: "The Highstate platform version to set.",
  })

  stdlibVersion = Option.String("--stdlib-version", {
    description: "The Highstate standard library version to set.",
  })

  platformOnly = Option.Boolean("--platform", false, {
    description: "Update only platform versions.",
  })

  stdlibOnly = Option.Boolean("--stdlib", false, {
    description: "Update only standard library versions.",
  })

  install = Option.Boolean("--install", true, {
    description: "Install dependencies after updating overrides.",
  })

  async execute(): Promise<void> {
    const projectRoot = process.cwd()

    await assertPackageJsonExists(projectRoot)

    if (this.platformOnly && this.stdlibOnly) {
      throw new Error('Flags "--platform" and "--stdlib" cannot be used together')
    }

    const updatePlatform = this.platformOnly || !this.stdlibOnly
    const updateStdlib = this.stdlibOnly || !this.platformOnly

    let currentPlatformVersion: string | undefined
    let resolvedStdlibVersion = this.stdlibVersion

    if (this.stdlibOnly) {
      const projectPlatformVersion = await getProjectPlatformVersion(projectRoot)
      if (!projectPlatformVersion) {
        throw new Error('Current platform version is not set in overrides for "@highstate/pulumi"')
      }

      currentPlatformVersion = projectPlatformVersion
      resolvedStdlibVersion = await resolveCompatibleStdlibVersion({
        currentPlatformVersion: projectPlatformVersion,
        stdlibVersion: this.stdlibVersion,
      })
    }

    const bundle = await resolveVersionBundle({
      platformVersion: updatePlatform ? this.platformVersion : currentPlatformVersion,
      stdlibVersion: updateStdlib ? resolvedStdlibVersion : undefined,
    })

    const overrides = buildOverrides(bundle)
    await applyOverrides({
      projectRoot,
      overrides,
    })
    await syncRootPulumiDependency({
      projectRoot,
      pulumiVersion: bundle.pulumiVersion,
    })

    logger.info(
      "updated overrides: platform=%s stdlib=%s pulumi=%s",
      bundle.platformVersion,
      bundle.stdlibVersion,
      bundle.pulumiVersion,
    )

    if (this.install) {
      const { installDependencies } = await import("nypm")

      logger.info("installing dependencies using bun...")

      await installDependencies({
        cwd: projectRoot,
        packageManager: "bun",
        silent: false,
      })
    }

    logger.info("update completed successfully")
  }
}

type ResolveCompatibleStdlibVersionArgs = {
  currentPlatformVersion: string
  stdlibVersion?: string
}

async function resolveCompatibleStdlibVersion(
  args: ResolveCompatibleStdlibVersionArgs,
): Promise<string> {
  const validPlatform = semver.valid(args.currentPlatformVersion)
  if (!validPlatform) {
    throw new Error(
      `Current platform version is not a valid semver "${args.currentPlatformVersion}"`,
    )
  }

  const targetStdlibVersion = args.stdlibVersion?.trim()
  if (targetStdlibVersion) {
    await assertStdlibSupportsPlatform({
      currentPlatformVersion: validPlatform,
      stdlibVersion: targetStdlibVersion,
    })

    return targetStdlibVersion
  }

  const packument = await fetchNpmPackument("@highstate/library")
  const sortedVersions = Object.entries(packument.versions ?? {})
    .filter(([version]) => semver.valid(version))
    .sort(([a], [b]) => semver.rcompare(a, b))

  for (const [stdlibVersion, stdlibManifest] of sortedVersions) {
    const supportedPlatformRange = getDependencyRange(stdlibManifest, "@highstate/pulumi")
    if (!supportedPlatformRange) {
      continue
    }

    const ok = semver.satisfies(validPlatform, supportedPlatformRange, {
      includePrerelease: true,
    })

    if (ok) {
      return stdlibVersion
    }
  }

  throw new Error(
    `Unable to find "@highstate/library" version compatible with platform "${validPlatform}"`,
  )
}

type StdlibPlatformCompatibilityArgs = {
  currentPlatformVersion: string
  stdlibVersion: string
}

async function assertStdlibSupportsPlatform(
  args: StdlibPlatformCompatibilityArgs,
): Promise<void> {
  const stdlibManifest = await fetchManifest("@highstate/library", args.stdlibVersion)
  const supportedPlatformRange = getDependencyRange(stdlibManifest, "@highstate/pulumi")
  if (!supportedPlatformRange) {
    throw new Error(
      `Unable to infer "@highstate/pulumi" version from "@highstate/library@${args.stdlibVersion}"`,
    )
  }

  const ok = semver.satisfies(args.currentPlatformVersion, supportedPlatformRange, {
    includePrerelease: true,
  })
  if (!ok) {
    throw new Error(
      `Current platform version "${args.currentPlatformVersion}" does not satisfy requirement "${supportedPlatformRange}"`,
    )
  }
}

async function assertPackageJsonExists(projectRoot: string): Promise<void> {
  try {
    await readFile(`${projectRoot}/package.json`, "utf8")
  } catch {
    throw new Error(`File "package.json" not found in "${projectRoot}"`)
  }
}

async function syncRootPulumiDependency(args: {
  projectRoot: string
  pulumiVersion: string
}): Promise<void> {
  const packageJsonPath = await resolvePackageJSON(args.projectRoot)
  const packageJson = await readPackageJSON(packageJsonPath)

  await writeJsonFile(packageJsonPath, {
    ...packageJson,
    dependencies: {
      ...(packageJson.dependencies ?? {}),
      "@pulumi/pulumi": args.pulumiVersion,
    },
  })
}
