import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { fingerprintFiles } from "./cache"

it("invalidates cached type information when dependencies, configuration, or the file set change", async () => {
  const root = await mkdtemp(join(tmpdir(), "style-cache-"))

  try {
    const consumer = join(root, "consumer.ts")
    const dependency = join(root, "dependency.ts")
    const config = join(root, "tsconfig.json")
    await writeFile(consumer, "export async function read() { return getValue() }")
    await writeFile(dependency, "export function getValue() { return 1 }")
    await writeFile(config, '{"compilerOptions":{"strict":true}}')
    const files = [consumer, dependency, config]
    const initial = await fingerprintFiles(files)

    expect(await fingerprintFiles([...files].reverse())).toBe(initial)

    await writeFile(dependency, "export async function getValue() { return 1 }")
    const changedDependency = await fingerprintFiles(files)
    expect(changedDependency).not.toBe(initial)

    await writeFile(config, '{"compilerOptions":{"strict":false}}')
    expect(await fingerprintFiles(files)).not.toBe(changedDependency)
    expect(await fingerprintFiles([consumer, config])).not.toBe(await fingerprintFiles(files))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
