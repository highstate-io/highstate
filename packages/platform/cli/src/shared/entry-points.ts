import type { PackageJson } from "pkg-types"
import { logger } from "./logger"

export interface EntryPoint {
  targetName: string
  entryPoint: string
  distPath: string
  isBin: boolean
  key: string
}

/**
 * Extracts entry points from package.json exports and bin fields
 */
export function extractEntryPoints(packageJson: PackageJson): Record<string, EntryPoint> {
  const exports = packageJson.exports
  let bin = packageJson.bin

  if (!exports && !bin) {
    logger.warn("no exports or bin found in package.json")
    return {}
  }

  if (exports !== undefined && (typeof exports !== "object" || Array.isArray(exports))) {
    throw new Error("Exports field in package.json must be an object")
  }

  if (bin !== undefined && typeof bin !== "object") {
    if (!packageJson.name) {
      throw new Error("Package name is required when bin is a string")
    }
    bin = { [packageJson.name]: bin as string }
  }

  const result: Record<string, EntryPoint> = {}

  // process exports entries
  if (exports) {
    for (const [key, value] of Object.entries(exports)) {
      let distPath: string

      if (typeof value === "string") {
        distPath = value
      } else if (typeof value === "object" && !Array.isArray(value)) {
        if (!value.default) {
          throw new Error(`Export "${key}" must have a default field in package.json`)
        }

        if (typeof value.default !== "string") {
          throw new Error(`Export "${key}" default field must be a string in package.json`)
        }

        distPath = value.default
      } else {
        throw new Error(`Export "${key}" must be a string or an object in package.json`)
      }

      const isJsonExport = distPath.endsWith(".json")
      const isJsExport = distPath.endsWith(".js")

      if (!isJsonExport && !isJsExport) {
        throw new Error(
          `The default value of export "${key}" must end with ".js" or ".json" in package.json, got "${distPath}"`,
        )
      }

      if (isJsExport && !distPath.startsWith("./dist/")) {
        throw new Error(
          `The default value of export "${key}" must start with "./dist/" when exporting ".js" in package.json, got "${distPath}"`,
        )
      }

      if (isJsonExport) {
        continue
      }

      const targetName = distPath.slice(7).slice(0, -3)

      result[targetName] = {
        entryPoint: `./src/${targetName}.ts`,
        targetName,
        distPath,
        isBin: false,
        key,
      }
    }
  }

  // process bin entries
  if (bin) {
    for (const [key, value] of Object.entries(bin)) {
      if (typeof value !== "string") {
        throw new Error(`Bin entry "${key}" must be a string in package.json`)
      }

      const distPath = value

      if (!distPath.startsWith("./dist/")) {
        throw new Error(
          `The value of bin entry "${key}" must start with "./dist/" in package.json, got "${distPath}"`,
        )
      }

      if (!distPath.endsWith(".js")) {
        throw new Error(
          `The value of bin entry "${key}" must end with ".js" in package.json, got "${distPath}"`,
        )
      }

      const targetName = distPath.slice(7).slice(0, -3)

      result[targetName] = {
        entryPoint: `./src/${targetName}.ts`,
        targetName,
        distPath,
        isBin: true,
        key,
      }
    }
  }

  return result
}
