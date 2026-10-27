import type { ArtifactBackend, ArtifactService } from "../artifact"
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import { Readable } from "node:stream"
import { HighstateSignature } from "@highstate/contract"
import { afterEach, describe, expect, test, vi } from "vitest"
import { RuntimeArtifactTransfer } from "./runtime-artifacts"

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve())
          server.closeAllConnections()
        }),
    ),
  )
})

async function setup(writable = true) {
  const content = Buffer.from("artifact bytes across a network boundary")
  const hash = createHash("sha256").update(content).digest("hex")
  const backend = {
    retrieve: vi
      .fn()
      .mockImplementation(async () => Readable.from([content.subarray(0, 8), content.subarray(8)])),
  }
  const stored: Uint8Array[] = []
  const service = {
    store: vi.fn().mockImplementation(async (_projectId, _hash, _size, _meta, stream) => {
      for await (const chunk of stream) stored.push(chunk)
      return { id: "stored-id" }
    }),
  }
  const transfer = new RuntimeArtifactTransfer(
    backend as unknown as ArtifactBackend,
    service as unknown as ArtifactService,
  )
  const server = createServer((request, response) => {
    void transfer.handle(request, response).then(handled => {
      if (!handled) response.writeHead(404).end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  const validate = vi.fn().mockResolvedValue(undefined)
  const authorization = transfer.issue(`http://127.0.0.1:${address.port}`, {
    projectId: "project",
    stateId: "state",
    reads: new Map([[hash, { id: "input-id", chunkSize: 4096 } as never]]),
    writable,
    validate,
  })
  const url = `${authorization.url}${hash}.tgz`
  return {
    content,
    hash,
    backend,
    service,
    stored,
    authorization,
    validate,
    url,
    declaration: JSON.stringify({ [HighstateSignature.Artifact]: true, hash }),
  }
}

describe("RuntimeArtifactTransfer", () => {
  test("streams only action-owned inputs and revokes the endpoint on action cleanup", async () => {
    const fixture = await setup()
    const response = await fetch(fixture.url)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.content)
    expect(fixture.backend.retrieve).toHaveBeenCalledWith("project", "input-id", 4096)
    const other = await fetch(`${fixture.authorization.url}${"f".repeat(64)}.tgz`)
    expect(other.status).toBe(400)
    expect(fixture.backend.retrieve).toHaveBeenCalledTimes(1)
    fixture.authorization.close()
    expect((await fetch(fixture.url)).status).toBe(401)
  })

  test("validates uploaded content and persists the exact streamed artifact", async () => {
    const fixture = await setup()
    const response = await fetch(fixture.url, {
      method: "PUT",
      headers: { "x-highstate-artifact": fixture.declaration },
      body: fixture.content,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: "stored-id" })
    expect(Buffer.concat(fixture.stored)).toEqual(fixture.content)
    expect(fixture.service.store.mock.calls[0]?.slice(0, 3)).toEqual([
      "project",
      fixture.hash,
      fixture.content.length,
    ])
    expect(fixture.validate).toHaveBeenCalledTimes(2)
  })

  test("rejects corrupted uploads before durable storage", async () => {
    const fixture = await setup()
    const response = await fetch(fixture.url, {
      method: "PUT",
      headers: { "x-highstate-artifact": fixture.declaration },
      body: "different bytes",
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("content hash mismatch")
    expect(fixture.service.store).not.toHaveBeenCalled()
  })

  test("rejects a lease lost during upload before durable storage", async () => {
    const fixture = await setup()
    fixture.validate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("Action lease replaced"))
    const response = await fetch(fixture.url, {
      method: "PUT",
      headers: { "x-highstate-artifact": fixture.declaration },
      body: fixture.content,
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("lease replaced")
    expect(fixture.service.store).not.toHaveBeenCalled()
  })

  test("preview transfers cannot upload outputs", async () => {
    const fixture = await setup(false)
    const response = await fetch(fixture.url, {
      method: "PUT",
      headers: { "x-highstate-artifact": fixture.declaration },
      body: fixture.content,
    })
    expect(response.status).toBe(405)
    expect(fixture.service.store).not.toHaveBeenCalled()
  })
})
