import { spawnSync } from "node:child_process"

const fix = process.argv.includes("--fix")
const roots = new Set<string>()

for await (const file of new Bun.Glob("packages/*/*/src/**/*.ts").scan()) {
  if (!file.includes("/_generated/")) {
    roots.add(file.split("/").slice(0, 3).join("/"))
  }
}

function check(paths: string[], typed: boolean): boolean {
  const result = spawnSync(
    "bun",
    ["run", "--bun", "eslint", ...paths, "--max-warnings=0", ...(fix ? ["--fix"] : [])],
    {
      stdio: "inherit",
      env: { ...process.env, HIGHSTATE_TYPED_LINT: String(typed) },
    },
  )

  if (result.error) {
    throw new Error("Failed to run style checks", { cause: result.error })
  }

  return result.status === 0
}

let passed = check(["."], false)

// separate processes release TypeScript's module graph between packages
for (const root of [...roots].sort()) {
  passed = check([`${root}/src`], true) && passed
}

process.exitCode = passed ? 0 : 1
