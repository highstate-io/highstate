#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { synchronizeRepositoryImages } from "./repository-images"

const value = (name: string): string => {
  const index = process.argv.indexOf(name)
  const result = index === -1 ? undefined : process.argv[index + 1]
  if (!result) {
    throw new Error(`Missing ${name}`)
  }

  return result.replace(/\/$/, "")
}

const prefix = value("--prefix")
const tag = value("--tag")
const output = value("--output")
const bakePath = value("--bake")
const rootIndex = process.argv.indexOf("--root")
const root = resolve(rootIndex === -1 ? resolve(import.meta.dir, "..") : process.argv[rootIndex + 1])
const bake = JSON.parse(await readFile(bakePath, "utf8"))
const imageNames = new Set<string>(
  bake.group.images.targets.map((target: string) => {
    const tag = bake.target[target].tags[0] as string
    return tag.slice(tag.lastIndexOf("/") + 1, tag.lastIndexOf(":"))
  }),
)

const result = await synchronizeRepositoryImages({
  root,
  prefix,
  tag,
  imageNames,
  async resolveDigest(reference) {
    const process = Bun.spawn(
      ["docker", "buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest.Digest}}"],
      {
        stdout: "pipe",
        stderr: "inherit",
      },
    )
    const digest = (await new Response(process.stdout).text()).trim().replace(/^"|"$/g, "")
    if ((await process.exited) !== 0) {
      throw new Error(`Unable to inspect "${reference}"`)
    }

    return digest
  },
})

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)

console.log(JSON.stringify(result))
