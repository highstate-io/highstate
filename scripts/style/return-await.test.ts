import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"

it("checks actual promise types across imports and fixes missing return awaits", async () => {
  const root = await mkdtemp(join(tmpdir(), "return-await-"))
  const source = join(root, "consumer.ts")
  const dependency = join(root, "dependency.ts")

  const lint = (fix = false) =>
    spawnSync(
      resolve("node_modules/.bin/oxlint"),
      ["--config", resolve(".oxlintrc.json"), "--type-aware", ...(fix ? ["--fix"] : []), source],
      { encoding: "utf8" },
    )

  try {
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          noEmit: true,
        },
        include: ["*.ts"],
      }),
    )

    await writeFile(dependency, "export function getValue() { return 1 }")

    await writeFile(
      source,
      'import { getValue } from "./dependency"; export async function read() { return getValue() }',
    )

    expect(lint().status).toBe(0)

    await writeFile(dependency, "export async function getValue() { return 1 }")
    const result = lint()
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("return-await")
    expect(lint(true).status).toBe(0)
    expect(await Bun.file(source).text()).toContain("return await getValue()")
    expect(lint().status).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
