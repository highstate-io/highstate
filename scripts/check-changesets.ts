#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

type Changeset = {
  id: string
  releases: Array<{
    name: string
    type: "patch" | "minor" | "major"
  }>
}

export function parseChangeset(id: string, source: string): Changeset {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== "---") {
    throw new Error(`Invalid changeset ".changeset/${id}.md": missing frontmatter`)
  }

  const frontmatterEnd = lines.indexOf("---", 1)
  if (frontmatterEnd === -1) {
    throw new Error(`Invalid changeset ".changeset/${id}.md": missing frontmatter delimiter`)
  }

  const releases = lines.slice(1, frontmatterEnd).filter(Boolean).map(line => {
    const match = line.match(/^(?:"([^"]+)"|'([^']+)'|([^:#][^:]*)):\s*(patch|minor|major)\s*$/)
    if (!match) {
      throw new Error(`Invalid release in changeset ".changeset/${id}.md": ${line}`)
    }

    return {
      name: (match[1] ?? match[2] ?? match[3] ?? "").trim(),
      type: match[4] as "patch" | "minor" | "major",
    }
  })

  return { id, releases }
}

export function validateChangesets(changesets: Changeset[]): void {
  const majorReleases = changesets.flatMap(changeset =>
    changeset.releases
      .filter(release => release.type === "major")
      .map(release => `.changeset/${changeset.id}.md (${release.name})`),
  )

  if (majorReleases.length > 0) {
    throw new Error(`Major changesets are not allowed: ${majorReleases.join(", ")}`)
  }
}

export async function checkChangesets(root: string): Promise<void> {
  const changesets: Changeset[] = []
  const glob = new Bun.Glob("*.md")

  for await (const path of glob.scan({ cwd: resolve(root, ".changeset"), onlyFiles: true })) {
    if (path === "README.md") {
      continue
    }

    const id = path.slice(0, -".md".length)
    changesets.push(parseChangeset(id, await readFile(resolve(root, ".changeset", path), "utf8")))
  }

  validateChangesets(changesets)
}

if (import.meta.main) {
  await checkChangesets(resolve(import.meta.dirname, ".."))
}
