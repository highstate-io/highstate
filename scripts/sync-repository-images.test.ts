import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "vitest"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true }))))

test.each([0, 1])("resolves archive digests without registry access (exit %s)", async exit => {
  const root = await mkdtemp(join(tmpdir(), "preview-images-"))
  roots.push(root)
  const bin = join(root, "bin")
  const assets = join(root, "packages", "standard", "example", "assets")
  await mkdir(bin)
  await mkdir(assets, { recursive: true })

  await writeFile(
    join(assets, "images.json"),
    JSON.stringify({ ssh: { name: "old/terminal.ssh", tag: "old", image: "old" } }),
  )

  const manifest = '{"schemaVersion":2,"manifests":[]}'

  await writeFile(
    join(bin, "skopeo"),
    `#!/bin/sh\n[ "$1" = inspect ] && [ "$2" = --raw ] && [ "$3" = "oci-archive:${root}/terminal-ssh.tar" ] || exit 2\nprintf '%s' '${manifest}'\nexit ${exit}\n`,
  )

  await chmod(join(bin, "skopeo"), 0o755)
  const reference = "ghcr.io/highstate-io/dev/terminal.ssh:pr-71"
  const bake = join(root, "bake.json")

  await writeFile(
    bake,
    JSON.stringify({
      group: { images: { targets: ["terminal-ssh"] } },
      target: { "terminal-ssh": { tags: [reference] } },
    }),
  )

  const output = join(root, "output.json")

  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      join(import.meta.dirname, "sync-repository-images.ts"),
      "--root",
      root,
      "--prefix",
      "ghcr.io/highstate-io/dev",
      "--tag",
      "pr-71",
      "--bake",
      bake,
      "--oci-directory",
      root,
      "--output",
      output,
    ],
    {
      env: { ...globalThis.process.env, PATH: `${bin}:${globalThis.process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const stderr = await new Response(process.stderr).text()
  if (exit) {
    expect(await process.exited).not.toBe(0)
    expect(stderr).toContain("Unable to inspect OCI archive")
    expect(JSON.parse(await readFile(join(assets, "images.json"), "utf8")).ssh.image).toBe("old")
  } else {
    expect(await process.exited, stderr).toBe(0)
    const digest = createHash("sha256").update(manifest).digest("hex")

    expect(JSON.parse(await readFile(output, "utf8")).images.ssh).toBe(
      `${reference}@sha256:${digest}`,
    )
  }
})
