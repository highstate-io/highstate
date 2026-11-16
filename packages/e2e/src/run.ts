import { root } from "./harness/designer"

const suite = process.argv[2] ?? "all"
if (!["all", "api", "browser", "cli", "runtime-browser"].includes(suite)) {
  throw new Error(`Unknown E2E suite: ${suite}`)
}

// Build once; API checks need neither Playwright nor a browser process.
for (const command of [
  [
    "bunx",
    "--bun",
    "nx",
    "run",
    suite === "cli" ? "@highstate/cli:build" : "@highstate/designer:build",
  ],
  ...(["all", "cli"].includes(suite) ? [[process.execPath, "packages/e2e/src/cli/smoke.ts"]] : []),
  ...(["all", "api"].includes(suite) ? [[process.execPath, "packages/e2e/src/api/smoke.ts"]] : []),
  ...(["all", "browser"].includes(suite)
    ? [[process.execPath, "packages/e2e/src/browser/smoke.ts"]]
    : []),
  ...(["all", "runtime-browser"].includes(suite)
    ? [[process.execPath, "packages/e2e/src/browser/runtime-smoke.ts"]]
    : []),
]) {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" })
  const code = await child.exited

  if (code !== 0) {
    process.exit(code)
  }
}
