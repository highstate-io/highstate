#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const value = (name: string): string => {
  const index = process.argv.indexOf(name)
  const result = index === -1 ? undefined : process.argv[index + 1]
  if (!result) {
    throw new Error(`Missing ${name}`)
  }

  return result
}

const base = value("--base")
const output = value("--output")
const rootIndex = process.argv.indexOf("--root")
const root = resolve(rootIndex === -1 ? "." : process.argv[rootIndex + 1])
const trustedRootIndex = process.argv.indexOf("--trusted-root")
const trustedRoot = resolve(trustedRootIndex === -1 ? root : process.argv[trustedRootIndex + 1])

const nx = Bun.spawn(["bun", "nx", "show", "projects", "--affected", `--base=${base}`, "--json"], {
  cwd: root,
  stdout: "pipe",
  stderr: "inherit",
})
const projects = JSON.parse(await new Response(nx.stdout).text()) as string[]

if ((await nx.exited) !== 0) {
  throw new Error("Unable to calculate affected projects")
}

const packages: Array<{ name: string; path: string }> = []

for (const project of projects) {
  const show = Bun.spawn(["bun", "nx", "show", "project", project, "--json"], {
    cwd: root,
    stdout: "pipe",
  })
  const configuration = JSON.parse(await new Response(show.stdout).text()) as { root: string; targets?: { build?: unknown } }
  if (
    (await show.exited) !== 0 ||
    !configuration.targets?.build ||
    !configuration.root.startsWith("packages/")
  ) {
    continue
  }

  try {
    const manifest = JSON.parse(
      await readFile(resolve(trustedRoot, configuration.root, "package.json"), "utf8"),
    ) as { name?: string; private?: boolean }
    if (manifest.name && !manifest.private) {
      packages.push({ name: manifest.name, path: configuration.root })
    }
  } catch {}
}

await writeFile(output, `${JSON.stringify(packages, null, 2)}\n`)

console.log(packages.map(pkg => pkg.path).join(" "))
