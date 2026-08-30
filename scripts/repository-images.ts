import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

type ImageEntry = { name: string; tag: string; image: string }
type Images = Record<string, ImageEntry>

function imageName(reference: string): string {
  const separator = reference.lastIndexOf("/")
  return reference.slice(separator + 1)
}

export async function discoverImageFiles(root: string): Promise<string[]> {
  const packagesRoot = join(root, "packages")
  const result: string[] = []

  for (const group of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) {
      continue
    }

    const groupRoot = join(packagesRoot, group.name)

    for (const pkg of await readdir(groupRoot, { withFileTypes: true })) {
      if (!pkg.isDirectory()) {
        continue
      }

      const path = join(groupRoot, pkg.name, "assets", "images.json")

      try {
        await readFile(path)
        result.push(path)
      } catch {}
    }
  }

  return result.sort()
}

export async function synchronizeRepositoryImages(args: {
  root: string
  prefix: string
  tag: string
  imageNames: ReadonlySet<string>
  resolveDigest: (reference: string) => Promise<string>
}): Promise<{ changedFiles: string[]; images: Record<string, string> }> {
  const changedFiles: string[] = []
  const resolved = new Map<string, string>()
  const images: Record<string, string> = {}

  for (const path of await discoverImageFiles(args.root)) {
    const original = await readFile(path, "utf8")
    const document = JSON.parse(original) as Images
    let changed = false

    for (const [key, entry] of Object.entries(document)) {
      const name = imageName(entry.name)
      if (!args.imageNames.has(name)) {
        continue
      }

      const repository = `${args.prefix}/${name}`
      const reference = `${repository}:${args.tag}`
      let digest = resolved.get(reference)

      if (!digest) {
        digest = await args.resolveDigest(reference)
        if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
          throw new Error(`Invalid digest for "${reference}": ${digest}`)
        }

        resolved.set(reference, digest)
      }

      const image = `${reference}@${digest}`
      images[key] = image

      if (entry.name !== repository || entry.tag !== args.tag || entry.image !== image) {
        document[key] = { ...entry, name: repository, tag: args.tag, image }
        changed = true
      }
    }

    if (changed) {
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
      changedFiles.push(path)
    }
  }

  return { changedFiles, images }
}

export async function applyRepositoryImages(args: {
  root: string
  images: Record<string, string>
}): Promise<string[]> {
  const changedFiles: string[] = []

  for (const path of await discoverImageFiles(args.root)) {
    const original = await readFile(path, "utf8")
    const document = JSON.parse(original) as Images
    let changed = false

    for (const [key, image] of Object.entries(args.images)) {
      if (!document[key]) {
        continue
      }

      const match = image.match(/^(.+):([^:@]+)@(sha256:[a-f0-9]{64})$/)
      if (!match) {
        throw new Error(`Invalid image reference for "${key}": ${image}`)
      }

      const [, name, tag] = match

      if (document[key].name !== name || document[key].tag !== tag || document[key].image !== image) {
        document[key] = { ...document[key], name, tag, image }
        changed = true
      }
    }

    if (changed) {
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
      changedFiles.push(path)
    }
  }

  return changedFiles
}
