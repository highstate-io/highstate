import type { IncomingMessage, ServerResponse } from "node:http"
import type { ServerHttp2Session } from "node:http2"
import type { AddressInfo, Socket } from "node:net"
import type { RuntimeCoordinator } from "@highstate/backend"
import type { RuntimeServiceOptions } from "./handlers/runtime"
import { readFile } from "node:fs/promises"
import { createSecureServer, type SecureServerOptions } from "node:http2"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { RuntimeService } from "@highstate/api/runtime.v1"
import { createRuntimeService } from "./handlers/runtime"

export type RuntimeServerOptions = RuntimeServiceOptions & {
  host?: string
  port: number
  tls: Pick<SecureServerOptions, "key" | "cert" | "ca">
  artifacts?: { handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> }
}

export type RuntimeListenerOptions = Pick<RuntimeServerOptions, "host" | "port" | "tls">

export interface RuntimeServer {
  address: AddressInfo | string | null
  shutdown(): Promise<void>
}

/**
 * Loads the optional dedicated listener configuration from the process environment.
 * TLS paths enable the listener on port 7284 unless an explicit runtime port is supplied.
 */
export async function loadRuntimeListenerOptions(): Promise<RuntimeListenerOptions | undefined> {
  const portValue = process.env.HIGHSTATE_RUNTIME_PORT
  const keyPath = process.env.HIGHSTATE_RUNTIME_TLS_KEY_PATH
  const certPath = process.env.HIGHSTATE_RUNTIME_TLS_CERT_PATH
  const caPath = process.env.HIGHSTATE_RUNTIME_TLS_CA_PATH
  if (portValue === undefined && !keyPath && !certPath && !caPath) {
    return undefined
  }

  if (!keyPath || !certPath) {
    throw new Error("Runtime TLS key and certificate paths are required")
  }

  if (portValue !== undefined && !/^\d+$/.test(portValue)) {
    throw new Error("Invalid runtime listener port")
  }

  const port = portValue === undefined ? 7284 : Number(portValue)
  validatePort(port)

  const [key, cert, ca] = await Promise.all([
    readFile(keyPath),
    readFile(certPath),
    caPath ? readFile(caPath) : undefined,
  ])

  return { host: process.env.HIGHSTATE_RUNTIME_HOST, port, tls: { key, cert, ca } }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid runtime listener port")
  }
}

/**
 * Starts the dedicated runtime gRPC listener with TLS and optional artifact downloads on the same host.
 */
export async function startRuntimeServer(
  coordinator: RuntimeCoordinator,
  options: RuntimeServerOptions,
): Promise<RuntimeServer> {
  validatePort(options.port)

  if (!options.tls.key || !options.tls.cert) {
    throw new Error("Runtime TLS key and certificate are required")
  }

  const handler = connectNodeAdapter({
    grpc: true,
    grpcWeb: false,
    connect: false,
    routes(router) {
      router.service(RuntimeService, createRuntimeService(coordinator, options))
    },
  })

  const server = createSecureServer(
    { ...options.tls, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] },
    (request, response) => {
      if (request.url?.startsWith("/runtime-artifacts/") && options.artifacts) {
        // the HTTP/2 compatibility API implements the HTTP/1 streaming surface used by artifact transfer
        void options.artifacts
          .handle(request as unknown as IncomingMessage, response as unknown as ServerResponse)
          .then(handled => {
            if (!handled) {
              response.writeHead(404).end()
            }
          })
          .catch(() => response.destroy())
      } else {
        handler(request, response)
      }
    },
  )

  const sessions = new Set<ServerHttp2Session>()
  const sockets = new Set<Socket>()
  server.on("tlsClientError", (_error, socket) => socket.destroy())

  server.on("secureConnection", socket => {
    socket.on("error", () => socket.destroy())
  })

  server.on("connection", socket => {
    sockets.add(socket)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => sockets.delete(socket))
  })

  server.on("session", session => {
    sessions.add(session)
    session.on("error", () => session.destroy())
    session.once("close", () => sessions.delete(session))
  })

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.removeListener("listening", listening)
      reject(error)
    }

    const listening = () => {
      server.removeListener("error", failed)
      resolve()
    }

    server.once("error", failed)
    server.once("listening", listening)
    server.listen(options.port, options.host ?? "0.0.0.0")
  })

  let shutdown: Promise<void> | undefined
  return {
    address: server.address(),
    async shutdown() {
      shutdown ??= new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))

        for (const session of sessions) {
          session.destroy()
        }

        for (const socket of sockets) {
          socket.destroy()
        }
      })

      await shutdown
    },
  }
}
