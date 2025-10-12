import type { Plugin } from "esbuild"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { encode } from "@msgpack/msgpack"
import { Command, Option } from "clipanion"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { mapValues } from "remeda"
import { build } from "tsup"
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

  watch = Option.Boolean("--watch", false)
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

    const esbuildPlugins: Plugin[] = []

    const binSourceFilePaths = Object.values(entryPoints)
      .filter(value => value.isBin)
      .map(value => value.entryPoint.slice(2)) // remove "./"

    if (this.library) {
      esbuildPlugins.push(schemaTransformerPlugin)
    }

    if (binSourceFilePaths.length > 0) {
      esbuildPlugins.push(createBinTransformerPlugin(binSourceFilePaths))
    }

    await build({
      entry: mapValues(entryPoints, value => value.entryPoint),
      outDir: "dist",
      watch: this.watch,
      sourcemap: true,
      clean: true,
      format: "esm",
      target: "es2024",
      platform: "node",
      external: ["@pulumi/pulumi"],
      esbuildPlugins,
      treeshake: true,
      removeNodeProtocol: false,
      silent: this.silent || ["warn", "error", "fatal"].includes(logger.level),
    })

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
