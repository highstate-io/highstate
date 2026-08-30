#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { applyRepositoryImages } from "./repository-images"

const value = (name: string): string => {
  const index = process.argv.indexOf(name)
  const result = index === -1 ? undefined : process.argv[index + 1]
  if (!result) {
    throw new Error(`Missing ${name}`)
  }

  return result
}

const metadata = JSON.parse(await readFile(value("--metadata"), "utf8")) as {
  images: Record<string, string>
}
const rootIndex = process.argv.indexOf("--root")
const root = resolve(rootIndex === -1 ? resolve(import.meta.dir, "..") : process.argv[rootIndex + 1])
const changedFiles = await applyRepositoryImages({ root, images: metadata.images })

console.log(JSON.stringify({ changedFiles, images: metadata.images }))
