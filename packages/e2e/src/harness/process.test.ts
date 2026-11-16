import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { command } from "./process"

const fixture = fileURLToPath(new URL("../../fixtures/process-tree.ts", import.meta.url))

it("closes inherited output pipes by stopping descendants after their parent exits", async () => {
  expect(await command([process.execPath, fixture], { timeoutMs: 5000 })).toBe("descendant ready")
}, 10000)

it("bounds the complete process tree when a command times out", async () => {
  await expect(
    command([process.execPath, fixture, "timeout"], { timeoutMs: 1000 }),
  ).rejects.toThrow("Command failed")
}, 10000)
