import { root } from "./designer"

// build the real production output and its workspace dependencies before opening a browser
for (const command of [
  ["bunx", "--bun", "nx", "run", "@highstate/designer:build"],
  [process.execPath, "packages/e2e/src/browser/smoke.ts"],
]) {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) {
    process.exit(code)
  }
}
