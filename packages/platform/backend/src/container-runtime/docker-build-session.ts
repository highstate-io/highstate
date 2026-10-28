import type { ImageBuildRequest } from "./contracts"
import type { DockerRuntimeConfig } from "./docker"
import { randomUUID } from "node:crypto"
import { connect as connectNet, type Socket } from "node:net"
import { connect as connectTls } from "node:tls"
import {
  Server,
  ServerCredentials,
  type ServerUnaryCall,
  type ServiceDefinition,
  type sendUnaryData,
  status,
} from "@grpc/grpc-js"
import protobuf from "protobufjs"
import { abortable } from "./contracts"

const protocol = protobuf.parse(`syntax = "proto3";
message CredentialsRequest { string Host = 1; }
message CredentialsResponse { string Username = 1; string Secret = 2; }
message GetSecretRequest { string ID = 1; }
message GetSecretResponse { bytes data = 1; }
`).root

function method(service: string, name: string, input: string, output: string) {
  const request = protocol.lookupType(input)
  const response = protocol.lookupType(output)
  return {
    path: `/${service}/${name}`,
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: object) =>
      Buffer.from(request.encode(request.create(value)).finish()),
    requestDeserialize: (bytes: Buffer) =>
      request.toObject(request.decode(bytes)) as Record<string, string>,
    responseSerialize: (value: object) =>
      Buffer.from(response.encode(response.create(value)).finish()),
    responseDeserialize: (bytes: Buffer) => response.toObject(response.decode(bytes)) as object,
  }
}

/** Serves BuildKit's reverse gRPC auth/secret APIs over the engine's h2c session upgrade. */
export async function openDockerBuildSession(
  config: DockerRuntimeConfig,
  request: ImageBuildRequest,
  signal?: AbortSignal,
): Promise<{ id: string; close: () => void }> {
  const id = randomUUID()
  const authService = "moby.filesync.v1.Auth"
  const secretService = "moby.buildkit.secrets.v1.Secrets"
  const auth: ServiceDefinition = {
    Credentials: method(authService, "Credentials", "CredentialsRequest", "CredentialsResponse"),
  }
  const secrets: ServiceDefinition = {
    GetSecret: method(secretService, "GetSecret", "GetSecretRequest", "GetSecretResponse"),
  }
  const server = new Server()
  const credentials = request.registryCredentials ?? config.registryCredentials ?? []
  const authImplementation = {
    Credentials: (
      call: ServerUnaryCall<Record<string, string>, object>,
      callback: sendUnaryData<object>,
    ) => {
      const host = String(call.request.Host ?? call.request.host)
      const credential = credentials.find(
        value =>
          value.serveraddress.replace(/^https?:\/\//, "").replace(/\/$/, "") === host ||
          (host === "registry-1.docker.io" && value.serveraddress === "docker.io"),
      )
      callback(null, { Username: credential?.username ?? "", Secret: credential?.password ?? "" })
    },
  }
  const secretImplementation = {
    GetSecret: (
      call: ServerUnaryCall<Record<string, string>, object>,
      callback: sendUnaryData<object>,
    ) => {
      const name = String(call.request.ID ?? call.request.id)
      const file = request.secrets?.find(file => file.path === name)
      if (!file) {
        callback({ code: status.NOT_FOUND, message: "Build secret not found" })
        return
      }
      callback(null, { data: Buffer.from(file.data) })
    },
  }
  server.addService(auth, authImplementation)
  server.addService(secrets, secretImplementation)
  let socket: Socket
  let host = "localhost"
  if (config.endpoint.startsWith("unix://")) socket = connectNet(config.endpoint.slice(7))
  else {
    const url = new URL(config.endpoint.replace(/^tcp:/, config.tls ? "https:" : "http:"))
    host = url.hostname
    const options = { host, port: Number(url.port || (url.protocol === "https:" ? 2376 : 2375)) }
    socket =
      url.protocol === "https:"
        ? connectTls({ ...options, ...config.tls, servername: host })
        : connectNet(options)
  }
  const close = () => {
    server.forceShutdown()
    socket.destroy()
    signal?.removeEventListener("abort", close)
  }
  signal?.addEventListener("abort", close, { once: true })
  // a peer reset can arrive while the injected grpc connection is shutting down
  socket.on("error", close)
  try {
    await abortable(
      new Promise<void>((resolve, reject) => {
        let headers = Buffer.alloc(0)
        const onError = (error: Error) => {
          socket.off("data", onData)
          reject(error)
        }
        const onData = (data: Buffer) => {
          headers = Buffer.concat([headers, data])
          if (headers.length > 65536) {
            reject(new Error("Docker session response headers exceed limit"))
            return
          }
          const end = headers.indexOf("\r\n\r\n")
          if (end === -1) return
          socket.off("data", onData)
          socket.off("error", onError)
          socket.pause()
          if (!/^HTTP\/1\.[01] (101|200)\b/.test(headers.toString("latin1", 0, end))) {
            reject(new Error("Docker engine rejected BuildKit session upgrade"))
            return
          }
          const rest = headers.subarray(end + 4)
          if (rest.length) socket.unshift(rest)
          const injector = server.createConnectionInjector(ServerCredentials.createInsecure())
          injector.injectConnection(socket)
          socket.resume()
          resolve()
        }
        socket.on("data", onData)
        socket.once("error", onError)
        const version = config.apiVersion ?? "v1.45"
        socket.write(
          `POST /${version}/session HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: h2c\r\nContent-Length: 0\r\nX-Docker-Expose-Session-Uuid: ${id}\r\nX-Docker-Expose-Session-Name: highstate\r\nX-Docker-Expose-Session-Grpc-Method: /${authService}/Credentials\r\nX-Docker-Expose-Session-Grpc-Method: /${secretService}/GetSecret\r\n\r\n`,
        )
      }),
      signal,
    )
    return { id, close }
  } catch (error) {
    close()
    throw error
  }
}
