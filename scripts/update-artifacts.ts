#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

type ArtifactParamValue = string | string[]
type ArtifactParams = Record<string, ArtifactParamValue>
type ArtifactParamConfig =
  | ArtifactParams
  | {
      base?: ArtifactParams
      groups?: ArtifactParams[]
    }

type ArtifactFile = {
  url: string
  sha256Url?: string
  path?: string
  sha256?: Record<string, string>
  params?: ArtifactParamConfig
  mappings?: Record<string, Record<string, string>>
}

type ArtifactManifest = Record<string, ArtifactFile>

type ArtifactPlanItem = {
  key: string
  shaKey: string
  url: string
  sha256Url?: string
}

const urlParamPattern = /\{([^{}]+)\}/g

async function main(): Promise<void> {
  const artifactsFile = Bun.argv[2]
  if (!artifactsFile) {
    throw new Error("Usage: update-artifacts.ts <artifacts-file> [--missing]")
  }

  const missingOnly = Bun.argv.slice(3).includes("--missing")
  const manifest = await readManifest(artifactsFile)
  const plan = createUpdatePlan(manifest, missingOnly)
  const tempDir = await mkdtemp(path.join(tmpdir(), "highstate-artifacts-"))

  try {
    for (const item of plan) {
      await updateArtifact(artifactsFile, item, tempDir)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function readManifest(file: string): Promise<ArtifactManifest> {
  return JSON.parse(await readFile(file, "utf8")) as ArtifactManifest
}

function createUpdatePlan(manifest: ArtifactManifest, missingOnly: boolean): ArtifactPlanItem[] {
  const plan: ArtifactPlanItem[] = []

  for (const [key, artifact] of Object.entries(manifest)) {
    const paramOrder = getParamOrder(artifact.url, artifact.sha256Url, artifact.path)

    for (const values of expandArtifactParamSets(artifact, key, paramOrder)) {
      const shaKey = getShaKey(paramOrder, values)
      if (missingOnly && artifact.sha256?.[shaKey]) {
        continue
      }

      plan.push({
        key,
        shaKey,
        url: resolveTemplate(artifact, artifact.url, paramOrder, values),
        sha256Url: artifact.sha256Url
          ? resolveTemplate(artifact, artifact.sha256Url, paramOrder, values)
          : undefined,
      })
    }
  }

  return plan
}

function getParamOrder(...templates: (string | undefined)[]): string[] {
  const names: string[] = []

  for (const template of templates) {
    if (!template) {
      continue
    }

    for (const match of template.matchAll(urlParamPattern)) {
      const name = match[1]
      if (names.includes(name)) {
        continue
      }

      names.push(name)
    }
  }

  return names
}

function isStructuredParams(params: ArtifactParamConfig): params is Exclude<ArtifactParamConfig, ArtifactParams> {
  return "base" in params || "groups" in params
}

function getArtifactParamSets(artifact: ArtifactFile): ArtifactParams[] {
  const params = artifact.params ?? {}
  if (!isStructuredParams(params)) {
    return [params]
  }

  const base = params.base ?? {}
  const groups = params.groups ?? []
  if (groups.length === 0) {
    return [base]
  }

  return groups.map(group => ({ ...base, ...group }))
}

function getParamValues(params: ArtifactParams, artifactKey: string, name: string): string[] {
  const value = params[name]
  if (value === undefined) {
    throw new Error(`Artifact "${artifactKey}" is missing parameter "${name}"`)
  }

  return Array.isArray(value) ? value : [value]
}

function expandArtifactParamSets(
  artifact: ArtifactFile,
  artifactKey: string,
  paramOrder: string[],
): Record<string, string>[] {
  return getArtifactParamSets(artifact).flatMap(params => {
    const orderedNames = [
      ...paramOrder,
      ...Object.keys(params).filter(name => !paramOrder.includes(name)),
    ]
    const valuesByName = orderedNames.map(name => [name, getParamValues(params, artifactKey, name)] as const)

    return expandParams(valuesByName)
  })
}

function expandParams(
  valuesByName: readonly (readonly [string, string[]])[],
  index: number = 0,
  current: Record<string, string> = {},
): Record<string, string>[] {
  if (index === valuesByName.length) {
    return [current]
  }

  const [name, values] = valuesByName[index]

  return values.flatMap(value => {
    return expandParams(valuesByName, index + 1, { ...current, [name]: value })
  })
}

function resolveTemplate(
  artifact: ArtifactFile,
  template: string,
  paramOrder: string[],
  values: Record<string, string>,
): string {
  let resolved = template

  for (const name of paramOrder) {
    const value = values[name]
    const mapped = artifact.mappings?.[name]?.[value] ?? value
    resolved = resolved.replaceAll(`{${name}}`, mapped)
  }

  return resolved
}

function getShaKey(paramOrder: string[], values: Record<string, string>): string {
  const names = [
    ...paramOrder,
    ...Object.keys(values).filter(name => !paramOrder.includes(name)),
  ]

  return names.map(name => values[name]).join("-") || "default"
}

async function updateArtifact(
  artifactsFile: string,
  item: ArtifactPlanItem,
  tempDir: string,
): Promise<void> {
  console.log(`Processing artifact: ${item.key} (${item.shaKey})`)

  const sha256 = item.sha256Url
    ? await fetchArtifactSha256(item)
    : await downloadAndHashArtifact(item, tempDir)

  const manifest = await readManifest(artifactsFile)
  manifest[item.key].sha256 ??= {}
  manifest[item.key].sha256![item.shaKey] = sha256

  await writeFile(artifactsFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Updated ${item.key}: sha256[${item.shaKey}]=${sha256}`)
}

async function fetchArtifactSha256(item: ArtifactPlanItem): Promise<string> {
  if (!item.sha256Url) {
    throw new Error(`Artifact "${item.key}" has no SHA256 URL`)
  }

  const response = await fetch(item.sha256Url)
  if (!response.ok) {
    throw new Error(`Failed to download SHA256 sums for artifact "${item.key}" from "${item.sha256Url}"`)
  }

  const fileName = path.posix.basename(new URL(item.url).pathname)
  const sums = await response.text()

  for (const line of sums.split("\n")) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)
    if (!match) {
      continue
    }

    if (path.posix.basename(match[2]) === fileName) {
      return match[1].toLowerCase()
    }
  }

  throw new Error(`SHA256 sum for artifact "${item.key}" file "${fileName}" was not found`)
}

async function downloadAndHashArtifact(item: ArtifactPlanItem, tempDir: string): Promise<string> {
  const response = await fetch(item.url)
  if (!response.ok) {
    throw new Error(`Failed to download artifact "${item.key}" from "${item.url}"`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  const tempFile = path.join(tempDir, `${item.key}-${item.shaKey}`)
  await writeFile(tempFile, content)

  return createHash("sha256")
    .update(content)
    .digest("hex")
}

await main()
