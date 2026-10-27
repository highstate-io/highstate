import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import { ImageRegistry } from "./registry"

describe("OCI registry verification", () => {
  it("uses scoped bearer credentials and verifies manifest and config bytes", async () => {
    const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    const config = Buffer.from(
      JSON.stringify({ config: { Labels: { "highstate.io/snapshot-hash": "snapshot" } } }),
    )
    const manifest = Buffer.from(
      JSON.stringify({ schemaVersion: 2, config: { digest: digest(config) }, layers: [] }),
    )
    let corrupt = false
    const scopes: string[] = []
    const server = createServer((request, response) => {
      const url = new URL(request.url!, `http://${request.headers.host}`)
      response.setHeader("Content-Type", "application/json")
      if (url.pathname === "/token") {
        expect(request.headers.authorization).toBe(
          `Basic ${Buffer.from("user:password").toString("base64")}`,
        )
        scopes.push(url.searchParams.get("scope")!)
        return response.end('{"token":"pull-token"}')
      }
      if (request.headers.authorization !== "Bearer pull-token") {
        response.statusCode = 401
        response.setHeader(
          "www-authenticate",
          `Bearer realm="http://${request.headers.host}/token",service="test"`,
        )
        return response.end("{}")
      }
      if (url.pathname.includes("/manifests/")) return response.end(manifest)
      return response.end(corrupt ? Buffer.from("corrupt-config") : config)
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const registry = `127.0.0.1:${(server.address() as { port: number }).port}`
    const client = new ImageRegistry({
      allowHttp: true,
      credentials: [{ serveraddress: registry, username: "user", password: "password" }],
    })
    try {
      const image = await client.inspect(`${registry}/project/snapshot:current`)
      expect(image).toEqual({
        reference: `${registry}/project/snapshot@${digest(manifest)}`,
        digest: digest(manifest),
        imageHash: "snapshot",
      })
      expect(scopes).toEqual([
        "repository:project/snapshot:pull",
        "repository:project/snapshot:pull",
      ])
      await expect(
        client.inspect(`${registry}/project/snapshot@sha256:${"0".repeat(64)}`),
      ).rejects.toThrow("manifest digest mismatch")
      corrupt = true
      await expect(client.inspect(image.reference)).rejects.toThrow("config digest mismatch")
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
