import type { IncomingMessage, ServerResponse } from "node:http"
import type { ArtifactBackend, ArtifactService } from "../artifact"
import type { Artifact } from "../database"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { pipeline } from "node:stream/promises"
import { unitArtifactSchema } from "@highstate/contract"

interface Transfer {
  projectId: string
  stateId: string
  reads: Map<string, Artifact>
  writable: boolean
  validate(): Promise<void>
}

/**
 * Action-scoped network transfer; paths on the backend host are never exposed to a runtime.
 */
export class RuntimeArtifactTransfer {
  private readonly transfers = new Map<string, Transfer>()

  constructor(
    private readonly backend: ArtifactBackend,
    private readonly service: ArtifactService,
  ) {}

  issue(baseUrl: string, transfer: Transfer): { url: string; close(): void } {
    const token = randomUUID()
    this.transfers.set(token, transfer)
    return {
      url: new URL(`/runtime-artifacts/${token}/`, baseUrl).href,
      close: () => {
        this.transfers.delete(token)
      },
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const match = /^\/runtime-artifacts\/([^/]+)\/([a-f0-9]{64})\.tgz$/.exec(request.url ?? "")
    if (!match) {
      return false
    }

    const transfer = this.transfers.get(match[1]!)
    if (!transfer) {
      response.writeHead(401).end()
      return true
    }

    // bun's HTTP/2 compatibility stream must be consumed before asynchronous authorization
    const body = request.method === "PUT" ? request.pipe(new PassThrough()) : undefined
    body?.on("error", () => {})
    const failed = (error: Error) => body?.destroy(error)
    request.on("error", failed)

    try {
      await transfer.validate()
      const hash = match[2]!

      if (request.method === "GET") {
        const artifact = transfer.reads.get(hash)
        if (!artifact) {
          throw new Error("Artifact is not an input to this action")
        }

        const content = await this.backend.retrieve(
          transfer.projectId,
          artifact.id,
          artifact.chunkSize,
        )

        if (!content) {
          response.writeHead(404).end()
          return true
        }

        response.writeHead(200, { "content-type": "application/gzip" })
        await pipeline(content, response)
      } else if (request.method === "PUT" && transfer.writable) {
        const declared = unitArtifactSchema.parse(
          JSON.parse(String(request.headers["x-highstate-artifact"])),
        )

        if (declared.hash !== hash) {
          throw new Error("Artifact declaration hash mismatch")
        }

        const directory = await mkdtemp("/tmp/highstate-artifact-transfer-")

        try {
          const path = join(directory, "artifact.tgz")
          const digest = createHash("sha256")
          let size = 0

          const input = (async function* () {
            for await (const chunk of body!) {
              const bytes = Buffer.from(chunk)
              digest.update(bytes)
              size += bytes.length
              yield bytes
            }
          })()

          await pipeline(input, createWriteStream(path))

          const actualHash = digest.digest("hex")
          if (actualHash !== hash) {
            throw new Error(
              `Artifact content hash mismatch: received ${size} bytes with hash "${actualHash}", expected "${hash}"`,
            )
          }

          await transfer.validate()

          const artifact = await this.service.store(
            transfer.projectId,
            hash,
            size,
            declared.meta ?? { title: `Artifact for "${transfer.stateId}"` },
            createReadStream(path),
            async (tx, artifact) => {
              await tx.instanceState.update({
                where: { id: transfer.stateId },
                data: { artifacts: { connect: { id: artifact.id } } },
              })
            },
          )

          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ id: artifact.id }))
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      } else {
        response.writeHead(405).end()
      }
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(400).end(String(error))
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      request.removeListener("error", failed)

      if (body) {
        request.unpipe(body)
        body.destroy()
        request.resume()
      }
    }

    return true
  }
}
