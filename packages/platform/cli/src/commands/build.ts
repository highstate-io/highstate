import { chmod, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { encode } from "@msgpack/msgpack"
import { Command, Option } from "clipanion"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import {
  createBinTransformerPlugin,
  extractEntryPoints,
  highstateConfigSchema,
  logger,
  SourceHashCalculator,
  schemaTransformerPlugin,
} from "../shared"

export class BuildCommand extends Command {
  static paths = [["build"]]

  static usage = Command.Usage({
    category: "Builder",
    description: "Builds the Highstate library or unit package.",
  })

  library = Option.Boolean("--library", false)
  silent = Option.Boolean("--silent", true)
  noSourceHash = Option.Boolean("--no-source-hash", false)

  async execute(): Promise<void> {
    const packageJson = await readPackageJSON()

    const highstateConfig = highstateConfigSchema.parse(packageJson.highstate ?? {})
    if (highstateConfig.type === "library") {
      this.library = true
    }

    if (highstateConfig.type === "worker") {
      this.noSourceHash = true
    }

    if (!packageJson.name) {
      throw new Error("package.json must have a name field")
    }

    const entryPoints = extractEntryPoints(packageJson)

    if (Object.keys(entryPoints).length === 0) {
      return
    }

    const bunPlugins: Bun.BunPlugin[] = []

    const binSourceFilePaths = Object.values(entryPoints)
      .filter(value => value.isBin)
      .map(value => value.entryPoint.slice(2)) // remove "./"

    if (this.library) {
      bunPlugins.push(schemaTransformerPlugin)
    }

    if (binSourceFilePaths.length > 0) {
      bunPlugins.push(createBinTransformerPlugin(binSourceFilePaths))
    }

    await rm("dist", { recursive: true, force: true })

    const bunEntryPoints = Object.values(entryPoints).map(value => value.entryPoint)

    const result = await Bun.build({
      entrypoints: bunEntryPoints,
      outdir: "dist",
      root: "./src",
      format: "esm",
      target: "bun",
      external: ["@pulumi/pulumi"],
      packages: "external",
      splitting: true,
      plugins: bunPlugins,
    })

    if (!result.success) {
      for (const log of result.logs) {
        logger.error(log.message)
      }

      throw new Error("build failed")
    }

    const binEntryPoints = Object.values(entryPoints).filter(value => value.isBin)
    for (const binEntryPoint of binEntryPoints) {
      const binPath = resolve(binEntryPoint.distPath)
      const binContent = await readFile(binPath, "utf8")

      if (!binContent.startsWith("#!/usr/bin/env bun\n")) {
        await writeFile(binPath, `#!/usr/bin/env bun\n${binContent}`, "utf8")
      }

      await chmod(binPath, 0o755)
    }

    const packageJsonPath = await resolvePackageJSON()
    const upToDatePackageJson = await readPackageJSON()

    if (!this.noSourceHash) {
      const sourceHashCalculator = new SourceHashCalculator(
        packageJsonPath,
        upToDatePackageJson,
        logger,
      )

      const distPathToExportKey = new Map<string, string>()
      for (const value of Object.values(entryPoints)) {
        distPathToExportKey.set(value.distPath, value.key)
      }

      await sourceHashCalculator.writeHighstateManifest("./dist", distPathToExportKey)
    }

    // write the "highstate.library.json" file if the library flag is set
    if (this.library) {
      const { loadLibrary } = await import("../shared/library-loader.js")
      const fullModulePaths = Object.values(entryPoints).map(value => resolve(value.distPath))

      logger.info("evaluating library components from modules: %s", fullModulePaths.join(", "))

      const library = await loadLibrary(logger, fullModulePaths)
      const libraryPath = resolve("./dist", "highstate.library.msgpack")

      await writeFile(libraryPath, encode(library), "utf8")
    }

    logger.info("build completed successfully")
  }
}
