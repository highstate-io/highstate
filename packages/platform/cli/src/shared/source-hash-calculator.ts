import type { Logger } from "pino"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { crc32 } from "@aws-crypto/crc32"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { type PackageJson, readPackageJSON, resolvePackageJSON } from "pkg-types"
import { z } from "zod"
import {
  type HighstateConfig,
  type HighstateManifest,
  highstateConfigSchema,
  highstateManifestSchema,
  type SourceHashConfig,
  sourceHashConfigSchema,
} from "./schemas"
import { int32ToBytes } from "./utils"

type FileDependency =
  | {
      type: "relative"
      id: string
      fullPath: string
    }
  | {
      type: "npm"
      id: string
      package: string
    }

export class SourceHashCalculator {
  private readonly dependencyHashes = new Map<string, Promise<number>>()
  private readonly fileHashes = new Map<string, Promise<number>>()

  constructor(
    private readonly packageJsonPath: string,
    private readonly packageJson: PackageJson,
    private readonly logger: Logger,
  ) {}

  /**
   * Calculates CRC32 hash of a string.
   */
  private hashString(input: string): number {
    return crc32(Buffer.from(input))
  }

  /**
   * Gets the highstate configuration from package.json with defaults.
   */
  private getHighstateConfig(packageJson: PackageJson): HighstateConfig {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const rawConfig = packageJson.highstate
    if (!rawConfig) {
      return { type: "source" }
    }

    try {
      return highstateConfigSchema.parse(rawConfig)
    } catch (error) {
      this.logger.warn(
        { error, packageName: packageJson.name },
        "invalid highstate configuration, using defaults",
      )
      return { type: "source" }
    }
  }

  /**
   * Gets the effective source hash configuration with defaults for a specific output.
   */
  private getSourceHashConfig(
    highstateConfig: HighstateConfig,
    exportKey?: string,
  ): SourceHashConfig {
    if (highstateConfig.sourceHash) {
      // Try to parse as a single config first
      const singleConfigResult = sourceHashConfigSchema.safeParse(highstateConfig.sourceHash)
      if (singleConfigResult.success) {
        return singleConfigResult.data
      }

      // Try to parse as a record of configs
      const recordConfigResult = z
        .record(z.string(), sourceHashConfigSchema)
        .safeParse(highstateConfig.sourceHash)
      if (recordConfigResult.success && exportKey) {
        const perOutputConfig = recordConfigResult.data[exportKey]
        if (perOutputConfig) {
          return perOutputConfig
        }
      }
    }

    if (highstateConfig.type === "library") {
      return { mode: "none" }
    }

    return { mode: "auto" }
  }

  async writeHighstateManifest(
    distBasePath: string,
    distPathToExportKey: Map<string, string>,
  ): Promise<void> {
    const highstateConfig = this.getHighstateConfig(this.packageJson)

    const promises: Promise<{ distPath: string; hash: number }>[] = []

    for (const [distPath, exportKey] of distPathToExportKey) {
      const fullPath = resolve(distPath)
      const sourceHashConfig = this.getSourceHashConfig(highstateConfig, exportKey)

      switch (sourceHashConfig.mode) {
        case "manual":
          promises.push(
            Promise.resolve({
              distPath,
              hash: this.hashString(sourceHashConfig.version),
            }),
          )
          break
        case "version":
          promises.push(
            Promise.resolve({
              distPath,
              hash: this.hashString(this.packageJson.version ?? ""),
            }),
          )
          break
        case "none":
          promises.push(
            Promise.resolve({
              distPath,
              hash: 0,
            }),
          )
          break
        default:
          promises.push(
            this.getFileHash(fullPath).then(hash => ({
              distPath,
              hash,
            })),
          )
          break
      }
    }

    const manifest: HighstateManifest = {
      sourceHashes: {},
    }

    const hashes = await Promise.all(promises)
    for (const { distPath, hash } of hashes) {
      manifest.sourceHashes![distPath] = hash
    }

    const manifestPath = resolve(distBasePath, "highstate.manifest.json")
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
  }

  private async getFileHash(fullPath: string): Promise<number> {
    const existingHash = this.fileHashes.get(fullPath)
    if (existingHash) {
      return existingHash
    }

    const hash = this.calculateFileHash(fullPath)
    this.fileHashes.set(fullPath, hash)

    return hash
  }

  private async calculateFileHash(fullPath: string): Promise<number> {
    const content = await readFile(fullPath, "utf8")
    const fileDeps = this.parseDependencies(fullPath, content)

    const hashes = await Promise.all([
      this.hashString(content),
      ...fileDeps.map(dep => this.getDependencyHash(dep)),
    ])

    return crc32(Buffer.concat(hashes.map(int32ToBytes)))
  }

  getDependencyHash(dependency: FileDependency): Promise<number> {
    const existingHash = this.dependencyHashes.get(dependency.id)
    if (existingHash) {
      return existingHash
    }

    const hash = this.calculateDependencyHash(dependency)
    this.dependencyHashes.set(dependency.id, hash)

    return hash
  }

  private async calculateDependencyHash(dependency: FileDependency): Promise<number> {
    switch (dependency.type) {
      case "relative": {
        return await this.getFileHash(dependency.fullPath)
      }
      case "npm": {
        let resolvedUrl: string
        try {
          const baseUrl = pathToFileURL(dirname(this.packageJsonPath))

          resolvedUrl = importMetaResolve(dependency.package, baseUrl.toString())
        } catch (error) {
          this.logger.error(`failed to resolve package "%s"`, dependency.package)
          throw error
        }

        if (resolvedUrl.startsWith("node:")) {
          throw new Error(`"${dependency.package}" imported without "node:" prefix`)
        }

        const resolvedPath = fileURLToPath(resolvedUrl)

        const [depPackageJsonPath, depPackageJson] = await this.getPackageJson(resolvedPath)
        const packageName = depPackageJson.name!

        this.logger.debug(
          `resolved package.json for "%s": "%s"`,
          dependency.package,
          depPackageJsonPath,
        )

        if (
          !this.packageJson.dependencies?.[packageName] &&
          !this.packageJson.peerDependencies?.[packageName]
        ) {
          this.logger.warn(`package "%s" is not listed in package.json dependencies`, packageName)
        }

        // try to get source hash from manifest first
        let relativePath = relative(dirname(depPackageJsonPath), resolvedPath)
        relativePath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`

        const highstateManifestPath = resolve(
          dirname(depPackageJsonPath),
          "dist",
          "highstate.manifest.json",
        )

        let manifest: HighstateManifest | undefined
        try {
          const manifestContent = await readFile(highstateManifestPath, "utf8")
          manifest = highstateManifestSchema.parse(JSON.parse(manifestContent))
        } catch (error) {
          this.logger.debug(
            { error },
            `failed to read highstate manifest for package "%s"`,
            packageName,
          )
        }

        const sourceHash = manifest?.sourceHashes?.[relativePath]

        if (sourceHash) {
          this.logger.debug(`resolved source hash for package "%s"`, packageName)
          return sourceHash
        }

        // use the package version as a fallback hash
        // this case will be applied for most npm packages
        this.logger.debug(`using package version as a fallback hash for "%s"`, packageName)
        return this.hashString(depPackageJson.version ?? "0.0.0")
      }
    }
  }

  private async getPackageJson(basePath: string): Promise<[string, PackageJson]> {
    while (true) {
      const packageJson = await readPackageJSON(basePath)
      if (packageJson.name) {
        const packageJsonPath = await resolvePackageJSON(basePath)

        return [packageJsonPath, packageJson]
      }

      basePath = resolve(dirname(basePath), "..")
    }
  }

  private parseDependencies(filePath: string, content: string): FileDependency[] {
    type DependencyMatch = {
      relativePath?: string
      nodeBuiltin?: string
      npmPackage?: string
    }

    const dependencyRegex =
      /^[ \t]*import[\s\S]*?\bfrom\s*["']((?<relativePath>\.\.?\/[^"']+)|(?<nodeBuiltin>node:[^"']+)|(?<npmPackage>[^"']+))["']/gm

    const matches = content.matchAll(dependencyRegex)
    const dependencies: FileDependency[] = []

    for (const match of matches) {
      const { nodeBuiltin, npmPackage, relativePath } = match.groups as DependencyMatch

      if (relativePath) {
        const fullPath = resolve(dirname(filePath), relativePath)

        dependencies.push({
          type: "relative",
          id: `relative:${fullPath}`,
          fullPath,
        })
      } else if (npmPackage) {
        dependencies.push({
          type: "npm",
          id: `npm:${npmPackage}`,
          package: npmPackage,
        })
      } else if (nodeBuiltin) {
        // ignore node built-in modules
      }
    }

    return dependencies
  }
}
