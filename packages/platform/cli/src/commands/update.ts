import { readFile } from "node:fs/promises"
import { Command, Option } from "clipanion"
import { detectPackageManager } from "nypm"
import semver from "semver"
import {
  applyOverrides,
  buildOverrides,
  fetchManifest,
  getDependencyRange,
  getProjectPlatformVersion,
  logger,
  resolveVersionBundle,
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

    const packageManager = await resolveProjectPackageManager(projectRoot)

    if (this.platformOnly && this.stdlibOnly) {
      throw new Error('Flags "--platform" and "--stdlib" cannot be used together')
    }

    const updatePlatform = this.platformOnly || !this.stdlibOnly
    const updateStdlib = this.stdlibOnly || !this.platformOnly

    if (this.stdlibOnly) {
      const currentPlatformVersion = await getProjectPlatformVersion(projectRoot, {
        packageManager,
      })
      if (!currentPlatformVersion) {
        throw new Error('Current platform version is not set in overrides for "@highstate/pulumi"')
      }

      const targetStdlibVersion = (this.stdlibVersion ?? "").trim()
      if (targetStdlibVersion.length === 0) {
        throw new Error('Flag "--stdlib-version" must be provided when using "--stdlib"')
      }

      const stdlibManifest = await fetchManifest("@highstate/library", targetStdlibVersion)
      const supportedPlatformRange = getDependencyRange(stdlibManifest, "@highstate/pulumi")
      if (!supportedPlatformRange) {
        throw new Error(
          `Unable to infer "@highstate/pulumi" version from "@highstate/library@${targetStdlibVersion}"`,
        )
      }

      const validPlatform = semver.valid(currentPlatformVersion)
      if (!validPlatform) {
        throw new Error(
          `Current platform version is not a valid semver "${currentPlatformVersion}"`,
        )
      }

      const ok = semver.satisfies(validPlatform, supportedPlatformRange, {
        includePrerelease: true,
      })
      if (!ok) {
        throw new Error(
          `Current platform version "${currentPlatformVersion}" does not satisfy requirement "${supportedPlatformRange}"`,
        )
      }
    }

    const bundle = await resolveVersionBundle({
      platformVersion: updatePlatform ? this.platformVersion : undefined,
      stdlibVersion: updateStdlib ? this.stdlibVersion : undefined,
    })

    const overrides = buildOverrides(bundle)
    await applyOverrides({
      projectRoot,
      packageManager,
      overrides,
    })

    logger.info(
      "updated overrides: platform=%s stdlib=%s pulumi=%s",
      bundle.platformVersion,
      bundle.stdlibVersion,
      bundle.pulumiVersion,
    )

    if (this.install) {
      const { installDependencies } = await import("nypm")

      logger.info("installing dependencies using %s...", packageManager)

      await installDependencies({
        cwd: projectRoot,
        packageManager,
        silent: false,
      })
    }

    logger.info("update completed successfully")
  }
}

async function resolveProjectPackageManager(projectRoot: string) {
  const detected = await detectPackageManager(projectRoot)
  if (!detected?.name) {
    throw new Error("Unable to detect package manager for this project")
  }

  if (detected.name === "bun") {
    throw new Error('Package manager "bun" is not supported')
  }

  if (detected.name === "deno") {
    throw new Error('Package manager "deno" is not supported')
  }

  if (detected.name !== "npm" && detected.name !== "pnpm" && detected.name !== "yarn") {
    throw new Error(`Unsupported package manager: "${detected.name}"`)
  }

  await assertPackageJsonExists(projectRoot)

  return detected.name
}

async function assertPackageJsonExists(projectRoot: string): Promise<void> {
  try {
    await readFile(`${projectRoot}/package.json`, "utf8")
  } catch {
    throw new Error(`File "package.json" not found in "${projectRoot}"`)
  }
}
