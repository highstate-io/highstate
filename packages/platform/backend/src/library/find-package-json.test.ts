import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test } from "vitest"
import { findPackageJSONCompat } from "./find-package-json"

describe("findPackageJSONPolyfill", () => {
  test("resolves bare package name from nearest node_modules ancestor", async () => {
    const sandbox = await mkdtemp(resolve(tmpdir(), "find-package-json-"))

    try {
      const projectRoot = resolve(sandbox, "project")
      const appDir = resolve(projectRoot, "apps", "api")
      const packageJsonPath = resolve(projectRoot, "package.json")
      const dependencyPackageJsonPath = resolve(
        projectRoot,
        "node_modules",
        "@highstate",
        "library",
        "package.json",
      )

      await mkdir(resolve(appDir), { recursive: true })
      await mkdir(resolve(projectRoot, "node_modules", "@highstate", "library"), {
        recursive: true,
      })
      await writeFile(packageJsonPath, '{"name":"project"}')
      await writeFile(dependencyPackageJsonPath, '{"name":"@highstate/library"}')

      const result = await findPackageJSONCompat("@highstate/library", resolve(appDir, "index.ts"))

      expect(result).toBe(dependencyPackageJsonPath)
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })

  test("resolves nearest package.json for relative path specifier", async () => {
    const sandbox = await mkdtemp(resolve(tmpdir(), "find-package-json-"))

    try {
      const projectRoot = resolve(sandbox, "project")
      const sourceDir = resolve(projectRoot, "src")
      const sourceFile = resolve(sourceDir, "entry.ts")
      const packageJsonPath = resolve(projectRoot, "package.json")

      await mkdir(sourceDir, { recursive: true })
      await writeFile(packageJsonPath, '{"name":"project"}')
      await writeFile(sourceFile, "export {}")

      const result = await findPackageJSONCompat("./entry.ts", pathToFileURL(sourceFile))

      expect(result).toBe(packageJsonPath)
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })

  test("returns undefined for missing bare package", async () => {
    const sandbox = await mkdtemp(resolve(tmpdir(), "find-package-json-"))

    try {
      const projectRoot = resolve(sandbox, "project")
      await mkdir(projectRoot, { recursive: true })

      const result = await findPackageJSONCompat(
        "missing-package",
        resolve(projectRoot, "index.ts"),
      )

      expect(result).toBeUndefined()
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })
})
