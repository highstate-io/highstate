import { mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { NpmProjectLibraryResolver, snapshotHash } from "@highstate/backend"
import { expect, it } from "vitest"
import { command } from "./process"
import { prepareFixtures, startRegistry } from "./registry"

it("builds publishable fixtures and resolves and reconstructs their registry graphs", async () => {
  const fixtures = await prepareFixtures()
  const registry = await startRegistry({ fixtures, publicHost: "127.0.0.1" })
  try {
    for (const pkg of fixtures.packages) {
      const entries = await command(["tar", "-tzf", pkg.archive])
      expect(entries).not.toContain("node_modules/")
      const manifest = JSON.parse(
        await command(["tar", "-xOzf", pkg.archive, "package/package.json"]),
      )
      expect(JSON.stringify(manifest)).not.toMatch(/workspace:|catalog:/)
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (!name.startsWith("@highstate/")) continue
          expect(
            fixtures.packages.some(target => target.name === name && target.version === range),
          ).toBe(true)
        }
      }
    }

    const resolver = new NpmProjectLibraryResolver(
      {
        forPackage: async () => ({ registryUrl: registry.url }),
        scopes: async () => ({ "@highstate": { registryUrl: registry.url } }),
      },
      {
        runtimeProtocolVersion: 1,
        packageFormatVersion: 1,
        bunVersion: Bun.version,
        pulumiVersion: "3.232.0",
      },
    )
    expect(await resolver.listVersions("fixture-test", "@highstate/e2e-library")).toEqual([
      "1.0.0",
      "2.0.0",
    ])
    let previousHash: number | undefined
    for (const version of ["1.0.0", "2.0.0"]) {
      const content = await resolver.resolve("fixture-test", [
        { packageName: "@highstate/e2e-library", version },
      ])
      expect(Object.keys(content.model.components).sort()).toEqual([
        "e2e.composite.v1",
        "e2e.marker.v1",
      ])
      const hash =
        content.sourceManifest.packages["@highstate/e2e-resources"]!.sourceHashes![
          "./dist/marker/index.js"
        ]
      expect(hash).toBeTypeOf("number")
      if (previousHash !== undefined) expect(hash).not.toBe(previousHash)
      previousHash = hash
      const directory = join(fixtures.directory, `reconstructed-${version}`)
      await mkdir(directory)
      const snapshot = { ...content, id: `fixture-${version}`, hash: snapshotHash(content) }
      await resolver.reconstruct("fixture-test", snapshot, directory)
      expect(await readFile(join(directory, "bun.lock"), "utf8")).toBe(content.lockfile)
      const implementation = JSON.parse(
        await readFile(
          join(directory, "node_modules/@highstate/e2e-resources/package.json"),
          "utf8",
        ),
      )
      expect(implementation.version).toBe(version)
      const entrypoint = Bun.resolveSync("@highstate/e2e-resources/marker", directory)
      expect(entrypoint).toMatch(/\/dist\/marker\/index\.js$/)
      expect(await readFile(entrypoint, "utf8")).toContain(version === "1.0.0" ? '"v1"' : '"v2"')
    }
    await expect(
      resolver.resolve("fixture-test", [
        { packageName: "@highstate/e2e-library", version: "1.0.0" },
        { packageName: "@highstate/e2e-conflicting", version: "1.0.0" },
      ]),
    ).rejects.toThrow(/conflict|duplicate/i)
  } finally {
    await registry.cleanup()
    await fixtures.cleanup()
  }
}, 600_000)
