import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { generateFromTemplate } from "./generator"

async function readUtf8(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8")
}

describe("generateFromTemplate", () => {
  it("copies files and replaces handlebars-style variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "highstate-generator-"))
    const templatePath = resolve(root, "template")
    const destinationPath = resolve(root, "dest")

    await mkdir(templatePath, { recursive: true })

    await writeFile(resolve(templatePath, "hello.txt"), "Hello, {{name}}!", "utf8")

    await generateFromTemplate(templatePath, destinationPath, { name: "World" })

    await expect(readUtf8(resolve(destinationPath, "hello.txt"))).resolves.toBe("Hello, World!")
  })

  it("removes .tpl from the end of destination filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "highstate-generator-"))
    const templatePath = resolve(root, "template")
    const destinationPath = resolve(root, "dest")

    await mkdir(templatePath, { recursive: true })

    await writeFile(resolve(templatePath, "config.json.tpl"), '{"name":"{{name}}"}', "utf8")

    await generateFromTemplate(templatePath, destinationPath, { name: "demo" })

    await expect(readUtf8(resolve(destinationPath, "config.json"))).resolves.toBe('{"name":"demo"}')
  })

  it("removes .tpl from the middle of destination filenames", async () => {
    const root = await mkdtemp(join(tmpdir(), "highstate-generator-"))
    const templatePath = resolve(root, "template")
    const destinationPath = resolve(root, "dest")

    await mkdir(templatePath, { recursive: true })

    await writeFile(
      resolve(templatePath, "package.tpl.json"),
      '{"name":"{{name}}","version":"{{version}}"}',
      "utf8",
    )

    await generateFromTemplate(templatePath, destinationPath, { name: "demo", version: "1.2.3" })

    await expect(readUtf8(resolve(destinationPath, "package.json"))).resolves.toBe(
      '{"name":"demo","version":"1.2.3"}',
    )
  })

  it("does not write files rendered to empty strings", async () => {
    const root = await mkdtemp(join(tmpdir(), "highstate-generator-"))
    const templatePath = resolve(root, "template")
    const destinationPath = resolve(root, "dest")

    await mkdir(templatePath, { recursive: true })

    await writeFile(resolve(templatePath, "maybe.txt"), "{{#if enabled}}ok{{/if}}", "utf8")

    await generateFromTemplate(templatePath, destinationPath, { enabled: "" })

    await expect(readFile(resolve(destinationPath, "maybe.txt"))).rejects.toThrow(/ENOENT/)
  })
})
