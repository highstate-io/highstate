import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fingerprintFiles } from "./cache"

const fix = process.argv.includes("--fix")
const cache = !process.argv.includes("--no-cache")
const cacheDirectory = "node_modules/.cache/highstate-style"
await mkdir(cacheDirectory, { recursive: true })

const syntaxInputs = ["eslint.config.mjs", "scripts/style/plugin.mjs", "bun.lock"]
const syntaxFingerprint = await fingerprintFiles(syntaxInputs)
const typedInputs = [".oxlintrc.json", "bun.lock", "package.json", "tsconfig.json"]
const roots = new Set<string>()

// type information can change through another package, generated declarations, or build outputs
for await (const path of new Bun.Glob("packages/**/*.{ts,json}").scan()) {
  if (path.includes("/node_modules/") || path.startsWith("packages/platform/docs/docus/")) {
    continue
  }

  typedInputs.push(path)

  if (/^packages\/[^/]+\/[^/]+\/src\//.test(path) && path.endsWith(".ts")) {
    roots.add(path.split("/").slice(0, 3).join("/"))
  }
}

async function check(tool: string, args: string[]): Promise<boolean> {
  const process = Bun.spawn(["bun", "run", "--bun", tool, ...args, ...(fix ? ["--fix"] : [])], {
    stdout: "inherit",
    stderr: "inherit",
  })

  return (await process.exited) === 0
}

async function syntaxCheck(): Promise<boolean> {
  return await check("eslint", [
    ".",
    "--max-warnings=0",
    ...(cache
      ? [
          "--cache",
          "--cache-strategy=content",
          `--cache-location=${cacheDirectory}/syntax-${syntaxFingerprint}`,
        ]
      : []),
  ])
}

async function typedCheck(): Promise<boolean> {
  const fingerprint = await fingerprintFiles(typedInputs)
  const cachePath = `${cacheDirectory}/typed`
  const cached = await readFile(cachePath, "utf8").catch(() => undefined)
  if (cache && cached === fingerprint) {
    return true
  }

  const passed = await check("oxlint", [
    "--type-aware",
    "--deny-warnings",
    ...[...roots].sort().map(root => `${root}/src`),
  ])

  if (cache && passed) {
    // Fixes can change the inputs; cache only the files that were actually checked.
    await writeFile(cachePath, fix ? await fingerprintFiles(typedInputs) : fingerprint)
  }

  return passed
}

const results = fix
  ? [await syntaxCheck(), await typedCheck()]
  : await Promise.all([syntaxCheck(), typedCheck()])

process.exitCode = results.every(Boolean) ? 0 : 1
