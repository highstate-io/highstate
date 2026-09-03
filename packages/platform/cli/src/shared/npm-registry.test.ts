import { gzipSync } from "node:zlib"
import { afterEach, describe, expect, test, vi } from "vitest"
import { fetchPackageManifest, getReleaseGroupPackages } from "./npm-registry"

afterEach(() => vi.restoreAllMocks())

test("fetchPackageManifest reads package.json from an npm tarball", async () => {
  const manifest = {
    name: "@highstate/contract",
    highstate: { release: { group: "platform", packages: ["@highstate/contract"] } },
  }
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(gzipSync(createTarEntry("package/package.json", JSON.stringify(manifest)))),
  )

  await expect(fetchPackageManifest("https://pkg.pr.new/package")).resolves.toEqual(manifest)
})

describe("getReleaseGroupPackages", () => {
  test("returns the requested release group", () => {
    expect(
      getReleaseGroupPackages(
        {
          name: "@highstate/contract",
          version: "0.31.0",
          highstate: {
            release: {
              group: "platform",
              packages: ["@highstate/contract", "create-highstate"],
            },
          },
        },
        "platform",
      ),
    ).toEqual(["@highstate/contract", "create-highstate"])
  })

  test("rejects releases without group metadata", () => {
    expect(() =>
      getReleaseGroupPackages({ name: "@highstate/contract", version: "0.30.0" }, "platform"),
    ).toThrow('does not include valid Highstate release group "platform" metadata')
  })

  test("rejects metadata for another group", () => {
    expect(() =>
      getReleaseGroupPackages(
        {
          name: "@highstate/contract",
          version: "0.31.0",
          highstate: { release: { group: "stdlib", packages: ["@highstate/library"] } },
        },
        "platform",
      ),
    ).toThrow('release group "platform"')
  })
})

function createTarEntry(path: string, content: string): Uint8Array {
  const encoder = new TextEncoder()
  const body = encoder.encode(content)
  const archive = new Uint8Array(512 + Math.ceil(body.length / 512) * 512 + 1024)
  archive.set(encoder.encode(path), 0)
  archive.set(encoder.encode(`${body.length.toString(8).padStart(11, "0")}\0`), 124)
  archive.set(body, 512)
  return archive
}
