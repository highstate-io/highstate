import { gzipSync } from "node:zlib"
import { afterEach, expect, test, vi } from "vitest"
import { resolvePreviewVersionBundle } from "./version-bundle"

afterEach(() => vi.restoreAllMocks())

test("resolvePreviewVersionBundle reads groups from preview and stable anchor packages", async () => {
  const platformManifest = {
    name: "@highstate/contract",
    highstate: {
      release: {
        group: "platform",
        packages: ["@highstate/contract", "create-highstate"],
      },
    },
  }
  const stdlibManifest = {
    name: "@highstate/library",
    version: "0.29.0",
    highstate: {
      release: {
        group: "stdlib",
        packages: ["@highstate/library", "@highstate/k8s"],
      },
    },
  }
  const previewUrl = "https://pkg.pr.new/highstate-io/highstate/@highstate/contract@abc"
  vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
    if (url === previewUrl) {
      return new Response(
        gzipSync(createTarEntry("package/package.json", JSON.stringify(platformManifest))),
      )
    }
    if (url === "https://registry.npmjs.org/%40highstate%2Flibrary") {
      return Response.json({ versions: { "0.29.0": stdlibManifest } })
    }

    return new Response(null, { status: 404 })
  })

  await expect(
    resolvePreviewVersionBundle({
      stable: {
        platformVersion: "0.31.0",
        stdlibVersion: "0.29.0",
        pulumiVersion: "3.232.0",
      },
      packages: { "@highstate/contract": previewUrl },
    }),
  ).resolves.toEqual({
    platformVersion: "0.31.0",
    stdlibVersion: "0.29.0",
    pulumiVersion: "3.232.0",
    platformPackages: ["@highstate/contract", "create-highstate"],
    stdlibPackages: ["@highstate/library", "@highstate/k8s"],
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
