import { createHash } from "node:crypto"
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import * as tar from "tar"

export const artifactArchValues = ["amd64", "arm64"] as const

export type ArtifactArch = (typeof artifactArchValues)[number]

export type ArtifactParamValue = string | string[]

export type ArtifactParams = Record<string, ArtifactParamValue>

export type ArtifactParamConfig =
  | ArtifactParams
  | {
      base?: ArtifactParams
      groups?: ArtifactParams[]
    }

export type ArtifactMappings = Record<string, Record<string, string>>

export type ArtifactFile = {
  url: string
  sha256: Record<string, string>
  path?: string
  params?: ArtifactParamConfig
  mappings?: ArtifactMappings
}

export type ResolvedArtifactFile = {
  url: string
  sha256: string
  path?: string
}

const urlParamPattern = /\{([^{}]+)\}/g

/**
 * Returns URL parameter names in first-occurrence order.
 *
 * @param url The URL template to inspect.
 * @returns The parameter names used by the URL template.
 */
export function getArtifactUrlParamOrder(url: string): string[] {
  const names: string[] = []

  for (const match of url.matchAll(urlParamPattern)) {
    const name = match[1]
    if (names.includes(name)) {
      continue
    }

    names.push(name)
  }

  return names
}

function replaceUrlParam(url: string, name: string, value: string): string {
  return url.replaceAll(`{${name}}`, value)
}

function mapParamValue(file: ArtifactFile, name: string, value: string): string {
  return file.mappings?.[name]?.[value] ?? value
}

function isStructuredParams(
  params: ArtifactParamConfig,
): params is Exclude<ArtifactParamConfig, ArtifactParams> {
  return "base" in params || "groups" in params
}

function isMatchingParamSet(params: ArtifactParams, constraints: ArtifactParams): boolean {
  for (const [name, expected] of Object.entries(constraints)) {
    const value = params[name]
    if (value === undefined) {
      continue
    }

    const values = Array.isArray(value) ? value : [value]
    const expectedValues = Array.isArray(expected) ? expected : [expected]
    if (!expectedValues.every(expectedValue => values.includes(expectedValue))) {
      return false
    }
  }

  return true
}

function getArtifactParamSets(file: ArtifactFile, constraints: ArtifactParams): ArtifactParams[] {
  const params = file.params ?? {}
  if (!isStructuredParams(params)) {
    return [{ ...params, ...constraints }]
  }

  const base = params.base ?? {}
  const groups = params.groups ?? []
  if (groups.length === 0) {
    return [{ ...base, ...constraints }]
  }

  return groups
    .map(group => ({ ...base, ...group }))
    .filter(group => isMatchingParamSet(group, constraints))
    .map(group => ({ ...group, ...constraints }))
}

function getArtifactParamOrder(file: ArtifactFile, params: ArtifactParams): string[] {
  const templateNames = [
    ...getArtifactUrlParamOrder(file.url),
    ...(file.path ? getArtifactUrlParamOrder(file.path) : []),
  ]
  const names: string[] = []

  for (const name of templateNames) {
    if (!names.includes(name)) {
      names.push(name)
    }
  }

  for (const name of Object.keys(params)) {
    if (!names.includes(name)) {
      names.push(name)
    }
  }

  return names
}

function isParamMatch(keyParts: string[], index: number, values: string[]): boolean {
  const keyPart = keyParts[index]
  if (!keyPart) {
    return false
  }

  return values.includes(keyPart)
}

/**
 * Resolves an artifact file URL and filters hashes for the provided parameters.
 *
 * Scalar parameters are substituted into the URL.
 * Array parameters constrain matching hashes but keep the URL placeholder unresolved.
 * Mappings only affect URL substitution and never affect hash keys.
 *
 * @param file The artifact file definition.
 * @param params The extra parameters to merge with parameters from the artifact definition.
 * @returns The artifact file with resolved URL/hash data and no parameter metadata.
 */
export function resolveArtifactFile(file: ArtifactFile, params: ArtifactParams = {}): ArtifactFile {
  const paramSets = getArtifactParamSets(file, params)
  const mergedParams = paramSets.length === 1 ? paramSets[0] : params
  const paramOrder = getArtifactUrlParamOrder(file.url)
  const shaKeyParamOrder = getArtifactParamOrder(file, mergedParams)
  const constraints = new Map<string, string[]>()
  let url = file.url

  for (const name of shaKeyParamOrder) {
    const value = mergedParams[name]
    if (!value) {
      continue
    }

    if (Array.isArray(value)) {
      constraints.set(name, value)
      continue
    }

    constraints.set(name, [value])
    if (paramOrder.includes(name)) {
      url = replaceUrlParam(url, name, mapParamValue(file, name, value))
    }
  }

  const sha256 = Object.fromEntries(
    Object.entries(file.sha256).filter(([key]) => {
      const keyParts = key.split("-")

      for (const [name, values] of constraints) {
        const index = shaKeyParamOrder.indexOf(name)
        if (index === -1) {
          continue
        }

        if (!isParamMatch(keyParts, index, values)) {
          return false
        }
      }

      return true
    }),
  )

  return {
    url,
    sha256,
    path: file.path
      ? getArtifactUrlParamOrder(file.path).reduce((path, name) => {
          const value = mergedParams[name]
          if (!value || Array.isArray(value)) {
            return path
          }

          return replaceUrlParam(path, name, mapParamValue(file, name, value))
        }, file.path)
      : undefined,
  }
}

function getArtifactArch(): ArtifactArch {
  switch (process.arch) {
    case "x64": {
      return "amd64"
    }

    case "arm64": {
      return "arm64"
    }

    default: {
      throw new Error(`Unsupported artifact architecture: ${process.arch}`)
    }
  }
}

function getSingleArtifactSha(file: ArtifactFile): string | undefined {
  const entries = Object.entries(file.sha256)
  if (entries.length !== 1) {
    return undefined
  }

  return entries[0][1]
}

function getArtifactCacheKey(name: string): string {
  return encodeURIComponent(name)
}

async function calculateSha256(path: string): Promise<string> {
  const content = await readFile(path)

  return createHash("sha256").update(content).digest("hex")
}

async function isMatchingArtifact(path: string, sha256: string): Promise<boolean> {
  try {
    return (await calculateSha256(path)) === sha256
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }

    throw error
  }
}

async function isMatchingArtifactArchive(
  path: string,
  artifactPath: string,
  sha256: string,
): Promise<boolean> {
  try {
    const marker = await readFile(resolve(path, ".sha256"), "utf8")
    await readFile(resolveArchivePath(path, artifactPath))

    return marker.trim() === sha256
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }

    throw error
  }
}

async function deleteStaleArtifacts(
  dir: string,
  cacheKey: string,
  targetFileName: string,
): Promise<void> {
  const files = await readdir(dir)

  for (const file of files) {
    if (!file.startsWith(`${cacheKey}-`) || file === targetFileName) {
      continue
    }

    await rm(resolve(dir, file), { recursive: true, force: true })
  }
}

async function downloadArtifactContent(url: string, sha256: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download artifact from "${url}"`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  const actualSha256 = createHash("sha256").update(content).digest("hex")

  if (actualSha256 !== sha256) {
    throw new Error(`SHA256 mismatch for artifact from "${url}"`)
  }

  return content
}

async function downloadArtifact(url: string, targetPath: string, sha256: string): Promise<void> {
  const content = await downloadArtifactContent(url, sha256)

  const tempPath = `${targetPath}.tmp-${process.pid}`

  try {
    await writeFile(tempPath, content)
    await chmod(tempPath, 0o755)
    await rename(tempPath, targetPath)
  } finally {
    await rm(tempPath, { force: true })
  }
}

function resolveArchivePath(root: string, path: string): string {
  const resolved = resolve(root, path)
  if (resolved !== root && resolved.startsWith(`${root}${sep}`)) {
    return resolved
  }

  throw new Error(`Invalid artifact archive path: "${path}"`)
}

async function downloadArtifactArchive(
  url: string,
  targetPath: string,
  artifactPath: string,
  sha256: string,
): Promise<void> {
  const content = await downloadArtifactContent(url, sha256)
  const tempArchivePath = `${targetPath}.tmp-${process.pid}.tar.gz`
  const tempExtractPath = `${targetPath}.tmp-${process.pid}`

  try {
    await writeFile(tempArchivePath, content)
    await rm(tempExtractPath, { recursive: true, force: true })
    await mkdir(tempExtractPath, { recursive: true })
    await tar.x({ file: tempArchivePath, cwd: tempExtractPath })

    const binaryPath = resolveArchivePath(tempExtractPath, artifactPath)
    await chmod(binaryPath, 0o755)
    await writeFile(resolve(tempExtractPath, ".sha256"), `${sha256}\n`)
    await rm(targetPath, { recursive: true, force: true })
    await rename(tempExtractPath, targetPath)
  } finally {
    await rm(tempArchivePath, { force: true })
    await rm(tempExtractPath, { recursive: true, force: true })
  }
}

/**
 * Resolves an artifact file for the current runtime architecture.
 *
 * The returned artifact has a concrete URL and exactly one expected SHA256 hash.
 *
 * @param file The artifact file definition.
 * @returns The concrete artifact URL and SHA256 hash.
 */
export function resolveCurrentArtifactFile(file: ArtifactFile): ResolvedArtifactFile {
  const resolved = resolveArtifactFile(file, { arch: getArtifactArch() })
  const sha256 = getSingleArtifactSha(resolved)
  if (!sha256) {
    throw new Error("Artifact must resolve to exactly one SHA256 hash")
  }

  return {
    url: resolved.url,
    sha256,
    path: resolved.path,
  }
}

/**
 * Downloads or reuses an artifact file from the Highstate cache.
 *
 * The cache directory is selected by the HIGHSTATE_CACHE_DIR environment variable.
 * The returned path points to an executable file verified by SHA256.
 *
 * @param name The artifact cache name.
 * @param file The artifact file definition.
 * @returns The full path to the cached artifact file.
 */
export async function resolveArtifact(name: string, file: ArtifactFile): Promise<string> {
  if (!process.env.HIGHSTATE_CACHE_DIR) {
    throw new Error("Environment variable HIGHSTATE_CACHE_DIR is not set")
  }

  const artifactsDir = resolve(process.env.HIGHSTATE_CACHE_DIR, "artifacts")
  await mkdir(artifactsDir, { recursive: true })

  const artifact = resolveCurrentArtifactFile(file)
  const cacheKey = getArtifactCacheKey(name)
  const targetFileName = `${cacheKey}-${artifact.sha256}`
  const targetPath = resolve(artifactsDir, targetFileName)

  if (artifact.path) {
    if (await isMatchingArtifactArchive(targetPath, artifact.path, artifact.sha256)) {
      await deleteStaleArtifacts(artifactsDir, cacheKey, targetFileName)

      return resolveArchivePath(targetPath, artifact.path)
    }

    await downloadArtifactArchive(artifact.url, targetPath, artifact.path, artifact.sha256)
    await deleteStaleArtifacts(artifactsDir, cacheKey, targetFileName)

    return resolveArchivePath(targetPath, artifact.path)
  }

  if (await isMatchingArtifact(targetPath, artifact.sha256)) {
    await deleteStaleArtifacts(artifactsDir, cacheKey, targetFileName)

    return targetPath
  }

  await downloadArtifact(artifact.url, targetPath, artifact.sha256)
  await deleteStaleArtifacts(artifactsDir, cacheKey, targetFileName)

  return targetPath
}
