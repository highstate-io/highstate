import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create, fromBinary, toBinary } from "@bufbuild/protobuf"
import { Server, ServerCredentials, type ServerDuplexStream } from "@grpc/grpc-js"
import {
  type ConnectRequest,
  ConnectRequestSchema,
  type ConnectResponse,
  ConnectResponseSchema,
  type ProxyWorkerRequest,
  ProxyWorkerRequestSchema,
  type ProxyWorkerResponse,
  ProxyWorkerResponseSchema,
} from "@highstate/api/runtime.v1"
import { expect, test, vi } from "vitest"
import { PanelTargetRegistry } from "./panel"
import { WorkerRuntimeClient } from "./runtime"

test("uses authenticated TLS gRPC controls and bounded reverse channels for binary panel traffic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "highstate-worker-grpc-"))
  const keyPath = join(directory, "key.pem")
  const certPath = join(directory, "cert.pem")

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  )

  const cert = await readFile(certPath)
  const server = new Server()

  const definition = {
    connect: {
      path: "/io.highstate.runtime.v1.RuntimeService/Connect",
      requestStream: true,
      responseStream: true,
      requestSerialize: (value: ConnectRequest) =>
        Buffer.from(toBinary(ConnectRequestSchema, value)),
      requestDeserialize: (value: Buffer) => fromBinary(ConnectRequestSchema, value),
      responseSerialize: (value: ConnectResponse) =>
        Buffer.from(toBinary(ConnectResponseSchema, value)),
      responseDeserialize: (value: Buffer) => fromBinary(ConnectResponseSchema, value),
    },
    proxyWorker: {
      path: "/io.highstate.runtime.v1.RuntimeService/ProxyWorker",
      requestStream: true,
      responseStream: true,
      requestSerialize: (value: ProxyWorkerRequest) =>
        Buffer.from(toBinary(ProxyWorkerRequestSchema, value)),
      requestDeserialize: (value: Buffer) => fromBinary(ProxyWorkerRequestSchema, value),
      responseSerialize: (value: ProxyWorkerResponse) =>
        Buffer.from(toBinary(ProxyWorkerResponseSchema, value)),
      responseDeserialize: (value: Buffer) => fromBinary(ProxyWorkerResponseSchema, value),
    },
  }

  let registered = false
  let requests = 0
  let responseStatus = 0
  const responseHeaders: { name: string; value: string }[] = []
  const responseBytes: number[] = []
  let completed: (() => void) | undefined

  const responseComplete = new Promise<void>(resolve => {
    completed = resolve
  })

  server.addService(definition, {
    connect(call: ServerDuplexStream<ConnectRequest, ConnectResponse>) {
      expect(call.metadata.get("authorization")).toEqual(["Bearer lease-token"])

      call.on("data", (value: ConnectRequest) => {
        if (value.event.case === "clientHello") {
          expect(value.event.value.leaseGeneration).toBe(2n)

          call.write(
            create(ConnectResponseSchema, {
              event: {
                case: "serverHello",
                value: { protocolVersion: 1, leaseDurationMs: 30000n, leaseGeneration: 2n },
              },
            }),
          )
        } else if (value.event.case === "workerRegistration") {
          registered = true

          call.write(
            create(ConnectResponseSchema, {
              event: {
                case: "workerControl",
                value: {
                  event: {
                    case: "unitRegistration",
                    value: { stateId: "state", params: { enabled: true } },
                  },
                },
              },
            }),
          )
        }
      })

      call.on("error", () => {})
    },
    proxyWorker(call: ServerDuplexStream<ProxyWorkerRequest, ProxyWorkerResponse>) {
      expect(call.metadata.get("authorization")).toEqual(["Bearer lease-token"])
      let active = false

      call.on("data", (value: ProxyWorkerRequest) => {
        if (value.event.case === "ready") {
          expect(value.event.value.leaseGeneration).toBe(2n)
          requests++

          if (requests !== 1) {
            return
          }

          active = true

          call.write(
            create(ProxyWorkerResponseSchema, {
              event: {
                case: "head",
                value: {
                  stateId: "state",
                  panelName: "panel",
                  method: "POST",
                  path: "/route?q=a%2Fb",
                  headers: [
                    { name: "x-test", value: "one" },
                    { name: "x-test", value: "two" },
                  ],
                },
              },
            }),
          )

          call.write(
            create(ProxyWorkerResponseSchema, {
              event: { case: "body", value: new Uint8Array([0, 255, 128]) },
            }),
          )

          call.write(
            create(ProxyWorkerResponseSchema, { event: { case: "body", value: new Uint8Array() } }),
          )
        } else if (value.event.case === "head") {
          responseStatus = value.event.value.statusCode
          responseHeaders.push(...value.event.value.headers)
        } else if (value.event.case === "body") {
          expect(value.event.value.byteLength).toBeLessThanOrEqual(65536)
          responseBytes.push(...value.event.value)
        }
      })

      call.on("end", () => {
        call.end()

        if (active) {
          completed!()
        }
      })

      call.on("error", () => {})
    },
  })

  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(
      "127.0.0.1:0",
      ServerCredentials.createSsl(null, [
        { private_key: execFileSync("openssl", ["pkey", "-in", keyPath]), cert_chain: cert },
      ]),
      (error, port) => (error ? reject(error) : resolve(port)),
    ),
  )

  const targets = new PanelTargetRegistry()

  targets.apply(
    "state",
    targets.prepare([
      {
        name: "panel",
        target: "http://unused.invalid",
        async interceptHttpRequest(request) {
          expect(new URL(request.url).pathname + new URL(request.url).search).toBe("/route?q=a%2Fb")
          expect(request.headers.get("x-test")).toContain("one")
          expect([...new Uint8Array(await request.arrayBuffer())]).toEqual([0, 255, 128])
          const headers = new Headers()
          headers.append("set-cookie", "a=1")
          headers.append("set-cookie", "b=2")
          return new Response(new Uint8Array(140000).fill(255), { status: 201, headers })
        },
      },
    ]),
  )

  const client = new WorkerRuntimeClient(
    {
      runtimeApiUrl: `https://localhost:${port}`,
      runtimeApiCaBundle: cert.toString(),
      runtimeToken: "lease-token",
      scope: {
        backendId: "backend",
        projectId: "project",
        runtimeId: "runtime",
        workloadId: "workload",
        generation: 2,
      },
      workerVersionId: "version",
      workerInstanceId: "instance",
    },
    targets,
  )

  const controls = vi.fn()

  const connecting = client.connect(async event => {
    controls(event)
  })

  void connecting.catch(() => {})

  try {
    await responseComplete
    expect(registered).toBe(true)

    expect(controls).toHaveBeenCalledWith({
      type: "register",
      stateId: "state",
      params: { enabled: true },
    })

    expect(responseStatus).toBe(201)

    expect(
      responseHeaders.filter(header => header.name === "set-cookie").map(header => header.value),
    ).toEqual(["a=1", "b=2"])

    expect(responseBytes.length).toBe(140000)
    expect(responseBytes.every(value => value === 255)).toBe(true)
    await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(4))
  } finally {
    client.close()
    server.forceShutdown()
    await connecting.catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
