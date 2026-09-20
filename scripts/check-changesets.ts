#!/usr/bin/env bun
import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

type Changeset = {
  id: string
  releases: Array<{
    name: string
    type: string
  }>
}

type ChangesetStatus = {
  changesets: Changeset[]
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
  const statusPath = resolve(tmpdir(), `highstate-changeset-status-${randomUUID()}.json`)

  try {
    const changeset = Bun.spawn(
      ["bun", "run", "changeset", "status", "--output", statusPath],
      {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit",
      },
    )
    if ((await changeset.exited) !== 0) {
      throw new Error("Unable to read pending changesets")
    }

    const status = JSON.parse(await readFile(statusPath, "utf8")) as ChangesetStatus
    validateChangesets(status.changesets)
  } finally {
    await rm(statusPath, { force: true })
  }
}

if (import.meta.main) {
  await checkChangesets(resolve(import.meta.dirname, ".."))
}
