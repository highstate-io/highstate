import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { rm } from "node:fs/promises"
import { applyRepositoryImages, synchronizeRepositoryImages } from "./repository-images"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true }))))

describe("synchronizeRepositoryImages", () => {
  test("updates managed images and preserves external images", async () => {
    const root = join(tmpdir(), `.repository-images-${crypto.randomUUID()}`)
    roots.push(root)
    const assets = join(root, "packages", "standard", "example", "assets")
    await mkdir(assets, { recursive: true })
    const path = join(assets, "images.json")
    await writeFile(path, JSON.stringify({
      "terminal-ssh": { name: "ghcr.io/highstate-io/highstate/terminal.ssh", tag: "latest", image: "old" },
      external: { name: "alpine", tag: "latest", image: "alpine@sha256:old" },
      phantun: { name: "ghcr.io/highstate-io/highstate/phantun", tag: "latest", image: "old" },
    }))
    const digest = `sha256:${"a".repeat(64)}`

    const result = await synchronizeRepositoryImages({
      root,
      prefix: "ghcr.io/highstate-io/dev",
      tag: "pr-12",
      imageNames: new Set([
        "terminal.kubectl",
        "terminal.restic",
        "terminal.ssh",
        "terminal.talosctl",
        "worker.k8s-monitor",
        "worker.k8s-dashboard",
      ]),
      resolveDigest: async () => digest,
    })

    expect(result.changedFiles).toEqual([path])
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      "terminal-ssh": {
        name: "ghcr.io/highstate-io/dev/terminal.ssh",
        tag: "pr-12",
        image: `ghcr.io/highstate-io/dev/terminal.ssh:pr-12@${digest}`,
      },
      external: { name: "alpine", tag: "latest", image: "alpine@sha256:old" },
      phantun: { name: "ghcr.io/highstate-io/highstate/phantun", tag: "latest", image: "old" },
    })
  })

  test("is idempotent", async () => {
    const root = join(tmpdir(), `.repository-images-${crypto.randomUUID()}`)
    roots.push(root)
    const assets = join(root, "packages", "standard", "example", "assets")
    await mkdir(assets, { recursive: true })
    const digest = `sha256:${"b".repeat(64)}`
    const image = `ghcr.io/highstate-io/terminal.ssh:latest@${digest}`
    await writeFile(join(assets, "images.json"), `${JSON.stringify({
      "terminal-ssh": { name: "ghcr.io/highstate-io/terminal.ssh", tag: "latest", image },
    }, null, 2)}\n`)

    const result = await synchronizeRepositoryImages({
      root,
      prefix: "ghcr.io/highstate-io",
      tag: "latest",
      imageNames: new Set(["terminal.ssh"]),
      resolveDigest: async () => digest,
    })
    expect(result.changedFiles).toEqual([])
  })

  test("updates only images selected by the bake definition", async () => {
    const root = join(tmpdir(), `.repository-images-${crypto.randomUUID()}`)
    roots.push(root)
    const assets = join(root, "packages", "standard", "example", "assets")
    await mkdir(assets, { recursive: true })
    const path = join(assets, "images.json")
    await writeFile(
      path,
      JSON.stringify({
        "terminal-ssh": {
          name: "ghcr.io/highstate-io/highstate/terminal.ssh",
          tag: "latest",
          image: "old-ssh",
        },
        "terminal-restic": {
          name: "ghcr.io/highstate-io/highstate/terminal.restic",
          tag: "latest",
          image: "old-restic",
        },
      }),
    )
    const digest = `sha256:${"d".repeat(64)}`

    await synchronizeRepositoryImages({
      root,
      prefix: "ghcr.io/highstate-io/dev",
      tag: "pr-12",
      imageNames: new Set(["terminal.ssh"]),
      resolveDigest: async () => digest,
    })

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      "terminal-ssh": {
        name: "ghcr.io/highstate-io/dev/terminal.ssh",
        tag: "pr-12",
        image: `ghcr.io/highstate-io/dev/terminal.ssh:pr-12@${digest}`,
      },
      "terminal-restic": {
        name: "ghcr.io/highstate-io/highstate/terminal.restic",
        tag: "latest",
        image: "old-restic",
      },
    })
  })

  test("applies trusted image metadata without registry access", async () => {
    const root = join(tmpdir(), `.repository-images-${crypto.randomUUID()}`)
    roots.push(root)
    const assets = join(root, "packages", "standard", "example", "assets")
    await mkdir(assets, { recursive: true })
    const path = join(assets, "images.json")
    await writeFile(path, JSON.stringify({
      "terminal-restic": { name: "old", tag: "old", image: "old" },
    }))
    const image = `ghcr.io/highstate-io/dev/terminal.restic:pr-2@sha256:${"c".repeat(64)}`
    expect(await applyRepositoryImages({ root, images: { "terminal-restic": image } })).toEqual([path])
    expect(JSON.parse(await readFile(path, "utf8"))["terminal-restic"]).toEqual({
      name: "ghcr.io/highstate-io/dev/terminal.restic",
      tag: "pr-2",
      image,
    })
  })
})
