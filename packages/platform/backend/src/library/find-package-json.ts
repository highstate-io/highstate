import { access } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Polyfill for resolving the path to a package.json file for a given module specifier and base URL.
 *
 * Context: https://github.com/oven-sh/bun/issues/23898
 */
export async function findPackageJSONCompat(
  specifier: string | URL,
  base?: string | URL,
): Promise<string | undefined> {
  const parsedSpecifier = toPathSpecifier(specifier)

  if (parsedSpecifier.type === "bare") {
    if (!base) {
      return undefined
    }

    const basePath = resolveBasePath(base)
    const baseDir = await normalizePathForLookup(basePath)

    return await findPackageJsonForBareSpecifier(baseDir, parsedSpecifier.value)
  }

  const resolvedPath = resolvePathSpecifier(parsedSpecifier.value, base)
  const lookupStart = await normalizePathForLookup(resolvedPath)

  return await findNearestPackageJson(lookupStart)
}

type PathSpecifier = { type: "bare"; value: string } | { type: "path"; value: string }

function toPathSpecifier(specifier: string | URL): PathSpecifier {
  if (specifier instanceof URL) {
    if (specifier.protocol !== "file:") {
      throw new Error(`Unsupported URL protocol "${specifier.protocol}"`)
    }

    return { type: "path", value: fileURLToPath(specifier) }
  }

  if (specifier.startsWith("file:")) {
    return { type: "path", value: fileURLToPath(new URL(specifier)) }
  }

  if (isBareSpecifier(specifier)) {
    return { type: "bare", value: specifier }
  }

  return { type: "path", value: specifier }
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("file:")
}

function resolvePathSpecifier(specifierPath: string, base?: string | URL): string {
  if (isAbsolute(specifierPath)) {
    return specifierPath
  }

  const basePath = base ? resolveBasePath(base) : process.cwd()

  if (specifierPath.startsWith(".")) {
    const baseDir = isLikelyFilePath(basePath) ? dirname(basePath) : basePath
    return resolve(baseDir, specifierPath)
  }

  return specifierPath
}

function resolveBasePath(base: string | URL): string {
  if (base instanceof URL) {
    if (base.protocol !== "file:") {
      throw new Error(`Unsupported base URL protocol "${base.protocol}"`)
    }

    return fileURLToPath(base)
  }

  if (base.startsWith("file:")) {
    return fileURLToPath(new URL(base))
  }

  return base
}

async function normalizePathForLookup(pathValue: string): Promise<string> {
  const existsAsFile = await pathExists(pathValue)
  if (existsAsFile && isLikelyFilePath(pathValue)) {
    return dirname(pathValue)
  }

  return pathValue
}

function isLikelyFilePath(pathValue: string): boolean {
  return pathValue.endsWith(".json") || pathValue.endsWith(".mjs") || pathValue.endsWith(".js")
}

async function findNearestPackageJson(startPath: string): Promise<string | undefined> {
  let current = startPath

  while (true) {
    const candidate = resolve(current, "package.json")
    if (await pathExists(candidate)) {
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

async function findPackageJsonForBareSpecifier(
  startDirectory: string,
  packageName: string,
): Promise<string | undefined> {
  let current = startDirectory

  while (true) {
    const candidate = resolve(current, "node_modules", packageName, "package.json")
    if (await pathExists(candidate)) {
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue)
    return true
  } catch {
    return false
  }
}
