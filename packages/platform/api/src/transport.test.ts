import { rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { createClient } from "@connectrpc/connect"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { afterEach, describe, expect, it } from "vitest"
import { ProjectService } from "./api/v1"
import { createAuthenticationInterceptor } from "./authentication"
import { createApiTransport } from "./transport"

const socketPath = `/tmp/highstate-api-${process.pid}.sock`
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()))
        }),
    ),
  )
  await rm(socketPath, { force: true })
})

describe("createApiTransport", () => {
  it("connects over a Unix socket and adds the authentication header", async () => {
    const server = createServer(
      connectNodeAdapter({
        routes(router) {
          router.service(ProjectService, {
            getProject(request, context) {
              return {
                project: {
                  id: context.requestHeader.get("authorization") ?? "",
                  name: request.projectId,
                },
                isLocked: false,
              }
            },
          })
        },
      }),
    )
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, resolve)
    })

    try {
      const transport = createApiTransport(`unix://${socketPath}`, [
        createAuthenticationInterceptor("hcp_key_secret"),
      ])
      const client = createClient(ProjectService, transport)
      const response = await client.getProject({ projectId: "project" })

      expect(response.project?.id).toBe("Bearer hcp_key_secret")
      expect(response.project?.name).toBe("project")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      })
    }
  })

  it("sends unary HTTP requests with a content length", async () => {
    let contentLength: string | undefined
    let transferEncoding: string | undefined
    const server = createServer((request, response) => {
      contentLength = request.headers["content-length"]
      transferEncoding = request.headers["transfer-encoding"]
      response.writeHead(200, { "content-type": "application/proto" })
      response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine test server address")
    }

    const transport = createApiTransport(`http://127.0.0.1:${address.port}`)
    const client = createClient(ProjectService, transport)
    await client.getProject({ projectId: "project" })

    expect(contentLength).toBe("9")
    expect(transferEncoding).toBeUndefined()
  })
})
