import type { DockerRuntimeConfig } from "./docker"
import { connect as connectNet, type Socket } from "node:net"
import { connect as connectTls } from "node:tls"
import { abortable } from "./contracts"

/**
 * Uses native sockets because Bun's HTTP client cannot expose Docker's upgraded duplex connection.
 */
export async function dockerHijack(
  config: DockerRuntimeConfig,
  path: string,
  body: object | undefined,
  signal?: AbortSignal,
): Promise<Socket> {
  signal?.throwIfAborted()
  let host = "localhost"
  let socket: Socket

  if (config.endpoint.startsWith("unix://")) {
    socket = connectNet(config.endpoint.slice(7))
  } else {
    const url = new URL(config.endpoint.replace(/^tcp:/, config.tls ? "https:" : "http:"))
    host = url.hostname
    const options = { host, port: Number(url.port || (url.protocol === "https:" ? 2376 : 2375)) }

    socket =
      url.protocol === "https:"
        ? connectTls({ ...options, ...config.tls, servername: host })
        : connectNet(options)
  }

  const close = () => socket.destroy(signal?.reason instanceof Error ? signal.reason : undefined)
  signal?.addEventListener("abort", close, { once: true })
  socket.once("close", () => signal?.removeEventListener("abort", close))

  try {
    await abortable(
      new Promise<void>((resolve, reject) => {
        let headers = Buffer.alloc(0)

        const error = (reason: Error) => {
          socket.off("data", data)
          reject(reason)
        }

        const data = (chunk: Buffer) => {
          headers = Buffer.concat([headers, chunk])
          const end = headers.indexOf("\r\n\r\n")
          if (end === -1) {
            if (headers.length > 65536) {
              reject(new Error("Docker response headers exceed limit"))
            }

            return
          }

          socket.off("data", data)
          socket.off("error", error)
          socket.setTimeout(0)
          socket.pause()

          if (!/^HTTP\/1\.[01] (101|200)\b/.test(headers.toString("latin1", 0, end))) {
            reject(new Error("Docker engine rejected duplex connection"))
            return
          }

          const rest = headers.subarray(end + 4)
          if (rest.length) {
            socket.unshift(rest)
          }

          resolve()
        }

        socket.on("data", data)
        socket.once("error", error)
        socket.setTimeout(30000, () => error(new Error("Docker duplex connection timed out")))
        const bytes = body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0)

        socket.write(
          `POST /${config.apiVersion ?? "v1.45"}${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\n\r\n`,
        )

        if (bytes.length) {
          socket.write(bytes)
        }
      }),
      signal,
    )

    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}
