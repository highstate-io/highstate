#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

type ArtifactParamValue = string | string[]

type ArtifactFile = {
  url: string
  sha256?: Record<string, string>
  params?: Record<string, ArtifactParamValue>
  mappings?: Record<string, Record<string, string>>
}

type ArtifactManifest = Record<string, ArtifactFile>

type ArtifactPlanItem = {
  key: string
  shaKey: string
  url: string
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
    const paramOrder = getParamOrder(artifact.url)
    const valuesByName = paramOrder.map(name => [name, getParamValues(artifact, key, name)] as const)

    for (const values of expandParams(valuesByName)) {
      const shaKey = paramOrder.map(name => values[name]).join("-") || "default"
      if (missingOnly && artifact.sha256?.[shaKey]) {
        continue
      }

      plan.push({
        key,
        shaKey,
        url: resolveUrl(artifact, paramOrder, values),
      })
    }
  }

  return plan
}

function getParamOrder(url: string): string[] {
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

function getParamValues(artifact: ArtifactFile, artifactKey: string, name: string): string[] {
  const value = artifact.params?.[name]
  if (value === undefined) {
    throw new Error(`Artifact "${artifactKey}" is missing parameter "${name}"`)
  }

  return Array.isArray(value) ? value : [value]
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

function resolveUrl(
  artifact: ArtifactFile,
  paramOrder: string[],
  values: Record<string, string>,
): string {
  let url = artifact.url

  for (const name of paramOrder) {
    const value = values[name]
    const mapped = artifact.mappings?.[name]?.[value] ?? value
    url = url.replaceAll(`{${name}}`, mapped)
  }

  return url
}

async function updateArtifact(
  artifactsFile: string,
  item: ArtifactPlanItem,
  tempDir: string,
): Promise<void> {
  console.log(`Processing artifact: ${item.key} (${item.shaKey})`)

  const response = await fetch(item.url)
  if (!response.ok) {
    throw new Error(`Failed to download artifact "${item.key}" from "${item.url}"`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  const tempFile = path.join(tempDir, `${item.key}-${item.shaKey}`)
  await writeFile(tempFile, content)

  const sha256 = createHash("sha256")
    .update(content)
    .digest("hex")

  const manifest = await readManifest(artifactsFile)
  manifest[item.key].sha256 ??= {}
  manifest[item.key].sha256![item.shaKey] = sha256

  await writeFile(artifactsFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Updated ${item.key}: sha256[${item.shaKey}]=${sha256}`)
}

await main()
