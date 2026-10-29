import type { AddressInfo } from "node:net"
import type { RuntimeCoordinator, Services, WorkerProxyChannel } from "@highstate/backend"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { connect } from "node:http2"
import { get } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create } from "@bufbuild/protobuf"
import { Code, createClient } from "@connectrpc/connect"
import { createGrpcTransport } from "@connectrpc/connect-node"
import {
  ConnectRequestSchema,
  ProxyWorkerRequestSchema,
  type ProxyWorkerResponse,
  RuntimeService,
  WorkloadKind,
} from "@highstate/api/runtime.v1"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { startBackendApi } from "./index"
import { loadRuntimeListenerOptions, startRuntimeServer } from "./runtime-server"

let key: string
let cert: string
afterEach(() => vi.unstubAllEnvs())
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "highstate-runtime-tls-"))

  try {
    cert = execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )

    cert = readFileSync(join(directory, "cert.pem"), "utf8")
    key = readFileSync(join(directory, "key.pem"), "utf8")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  return {
    leaseDurationMs: 30_000,
    connect: vi.fn(async () => ({ scope: { workloadId: "workload", generation: 1 } })),
    authenticate: vi.fn(async () => ({})),
    receive: vi.fn(async () => {}),
    disconnected: vi.fn(async () => {}),
  }
}

describe("dedicated runtime TLS listener", () => {
  it("starts through the backend API and exchanges a proxied HTTP request through request EOF and response half-close", async () => {
    const directory = mkdtempSync(join(tmpdir(), "highstate-api-"))

    const scope = {
      backendId: "backend",
      projectId: "project",
      runtimeId: "runtime",
      workloadId: "worker",
      kind: "worker",
      generation: 1,
    }

    const connection = { scope }
    let registered!: (channel: WorkerProxyChannel) => void

    const available = new Promise<WorkerProxyChannel>(resolve => {
      registered = resolve
    })

    const signer = { verify: vi.fn(() => scope) }

    const artifacts = {
      handle: vi.fn(async (_request, response) => {
        response.end("archive")
        return true
      }),
    }

    const services = {
      logger: { info: vi.fn(), error: vi.fn() },
      runtimeCoordinator: {
        leaseDurationMs: 30_000,
        connections: { current: vi.fn(() => connection) },
        authenticate: vi.fn(async () => {}),
      },
      runtimeCredentialSigner: signer,
      runtimeArtifactTransfer: artifacts,
      workerProxyRegistry: { register: vi.fn(async (_connection, channel) => registered(channel)) },
    }

    const api = await startBackendApi(services as unknown as Services, {
      workerSocketPath: join(directory, "worker.sock"),
      runtime: { host: "127.0.0.1", port: 0, tls: { key, cert } },
    })

    try {
      const client = createClient(
        RuntimeService,
        createGrpcTransport({
          baseUrl: `https://127.0.0.1:${(api.runtimeAddress as AddressInfo).port}`,
          nodeOptions: { ca: cert },
        }),
      )

      let endRequest!: () => void

      const requestEnded = new Promise<void>(resolve => {
        endRequest = resolve
      })

      async function* workerFrames() {
        yield create(ProxyWorkerRequestSchema, {
          event: {
            case: "ready",
            value: { workloadId: "worker", leaseGeneration: 1n },
          },
        })

        await requestEnded

        yield create(ProxyWorkerRequestSchema, {
          event: {
            case: "head",
            value: { statusCode: 201, headers: [{ name: "set-cookie", value: "a=1" }] },
          },
        })

        yield create(ProxyWorkerRequestSchema, {
          event: { case: "body", value: new Uint8Array([255, 1]) },
        })
      }
      const frames: ProxyWorkerResponse[] = []

      const receiving = (async () => {
        for await (const frame of client.proxyWorker(workerFrames(), {
          headers: { authorization: "Bearer proxy-token" },
        })) {
          frames.push(frame)

          if (frame.event.case === "body" && frame.event.value.byteLength === 0) {
            endRequest()
          }
        }
      })()

      const channel = await available

      const response = await channel.request({
        method: "POST",
        path: "/panel?query=1",
        stateId: "state",
        panelName: "panel",
        headers: [
          { name: "x-example", value: "one" },
          { name: "x-example", value: "two" },
        ],
        body: (async function* () {
          yield new Uint8Array([0, 128])
        })(),
      })

      const chunks = []

      for await (const chunk of response.body) {
        chunks.push(chunk)
      }

      await receiving
      expect(signer.verify).toHaveBeenCalledWith("proxy-token", "proxy")
      expect(response.status).toBe(201)
      expect(response.headers).toMatchObject([{ name: "set-cookie", value: "a=1" }])
      expect(chunks).toEqual([new Uint8Array([255, 1])])

      expect(frames.map(frame => frame.event)).toMatchObject([
        {
          case: "head",
          value: {
            method: "POST",
            path: "/panel?query=1",
            stateId: "state",
            panelName: "panel",
            headers: [
              { name: "x-example", value: "one" },
              { name: "x-example", value: "two" },
            ],
          },
        },
        { case: "body", value: new Uint8Array([0, 128]) },
        { case: "body", value: new Uint8Array() },
      ])
    } finally {
      await api.shutdown()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("removes the public socket when dedicated TLS startup fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "highstate-api-failure-"))
    const workerSocketPath = join(directory, "worker.sock")

    try {
      await expect(
        startBackendApi({ logger: { info: vi.fn() } } as unknown as Services, {
          workerSocketPath,
          runtime: { port: 0, tls: {} },
        }),
      ).rejects.toThrow("Failed to start backend api")

      expect(existsSync(workerSocketPath)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("loads TLS material from environment paths and validates partial configuration before binding", async () => {
    for (const name of ["PORT", "TLS_KEY_PATH", "TLS_CERT_PATH", "TLS_CA_PATH", "HOST"]) {
      vi.stubEnv(`HIGHSTATE_RUNTIME_${name}`, undefined)
    }

    expect(await loadRuntimeListenerOptions()).toBeUndefined()
    vi.stubEnv("HIGHSTATE_RUNTIME_PORT", "7284")

    await expect(loadRuntimeListenerOptions()).rejects.toThrow(
      "key and certificate paths are required",
    )

    vi.stubEnv("HIGHSTATE_RUNTIME_TLS_KEY_PATH", "/missing-key")
    vi.stubEnv("HIGHSTATE_RUNTIME_TLS_CERT_PATH", "/missing-cert")

    for (const port of ["", "-1", "65536", "3.5", "invalid"]) {
      vi.stubEnv("HIGHSTATE_RUNTIME_PORT", port)
      await expect(loadRuntimeListenerOptions()).rejects.toThrow("Invalid runtime listener port")
    }

    vi.stubEnv("HIGHSTATE_RUNTIME_PORT", "0")

    vi.stubEnv(
      "HIGHSTATE_RUNTIME_TLS_KEY_PATH",
      new URL("./runtime-server.ts", import.meta.url).pathname,
    )

    vi.stubEnv(
      "HIGHSTATE_RUNTIME_TLS_CERT_PATH",
      new URL("./runtime-server.test.ts", import.meta.url).pathname,
    )

    vi.stubEnv(
      "HIGHSTATE_RUNTIME_TLS_CA_PATH",
      new URL("./runtime-server.test.ts", import.meta.url).pathname,
    )

    vi.stubEnv("HIGHSTATE_RUNTIME_HOST", "127.0.0.1")
    const options = await loadRuntimeListenerOptions()
    expect(options).toMatchObject({ host: "127.0.0.1", port: 0 })
    expect(options?.tls.key).toEqual(readFileSync(new URL("./runtime-server.ts", import.meta.url)))

    expect(options?.tls.cert).toEqual(
      readFileSync(new URL("./runtime-server.test.ts", import.meta.url)),
    )

    expect(options?.tls.ca).toEqual(options?.tls.cert)
  })

  it("serves bidirectional gRPC and artifact downloads over verified HTTP/2 TLS on the same port", async () => {
    const coordinator = fixture()
    let accepted: () => void = () => {}

    const received = new Promise<void>(resolve => {
      accepted = resolve
    })

    coordinator.receive.mockImplementation(async () => {
      accepted()
    })

    const artifacts = {
      handle: vi.fn(async (_request, response) => {
        response.setHeader("content-type", "application/gzip")
        response.end(Buffer.from([0, 255, 1]))
        return true
      }),
    }

    const server = await startRuntimeServer(coordinator as unknown as RuntimeCoordinator, {
      host: "127.0.0.1",
      port: 0,
      tls: { key, cert },
      artifacts,
    })

    try {
      const baseUrl = `https://127.0.0.1:${(server.address as AddressInfo).port}`

      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const session = connect(baseUrl, { ca: cert })
        session.on("error", reject)
        const request = session.request({ ":path": "/runtime-artifacts/token/hash.tgz" })
        const chunks: Buffer[] = []
        request.on("data", chunk => chunks.push(chunk))

        request.on("end", () => {
          session.close()
          resolve(Buffer.concat(chunks))
        })

        request.on("error", error => {
          session.close()
          reject(error)
        })

        request.end()
      })

      expect(bytes).toEqual(Buffer.from([0, 255, 1]))
      expect(artifacts.handle.mock.calls[0]?.[0].url).toBe("/runtime-artifacts/token/hash.tgz")

      const client = createClient(
        RuntimeService,
        createGrpcTransport({ baseUrl, nodeOptions: { ca: cert } }),
      )

      let acknowledgeHello!: () => void

      const helloReceived = new Promise<void>(resolve => {
        acknowledgeHello = resolve
      })

      async function* requests() {
        yield create(ConnectRequestSchema, {
          event: {
            case: "clientHello",
            value: {
              minimumProtocolVersion: 1,
              maximumProtocolVersion: 1,
              workloadKind: WorkloadKind.PULUMI,
              workloadId: "workload",
              backendId: "backend",
              projectId: "project",
              containerRuntimeId: "runtime",
              leaseGeneration: 1n,
            },
          },
        })

        await helloReceived

        yield create(ConnectRequestSchema, {
          event: { case: "heartbeat", value: { sequence: 1n } },
        })

        await received
      }
      const responses = []

      for await (const response of client.connect(requests(), {
        headers: { authorization: "Bearer runtime-token" },
      })) {
        responses.push(response)

        if (response.event.case === "serverHello") {
          acknowledgeHello()
        }
      }

      expect(responses).toMatchObject([
        { event: { case: "serverHello", value: { protocolVersion: 1, leaseGeneration: 1n } } },
      ])

      expect(coordinator.receive).toHaveBeenCalledWith(expect.any(Object), {
        type: "heartbeat",
        sequence: 1,
      })
    } finally {
      await server.shutdown()
      await server.shutdown()
    }
  })

  // Bun 1.3 does not implement node:http2 allowHTTP1; run this interoperability check under Node.
  it.skipIf(typeof Bun !== "undefined" && "version" in Bun)(
    "serves HTTP/1.1 artifact clients on the same TLS listener",
    async () => {
      const artifacts = {
        handle: vi.fn(async (_request, response) => {
          response.end("archive")
          return true
        }),
      }

      const server = await startRuntimeServer(fixture() as unknown as RuntimeCoordinator, {
        host: "127.0.0.1",
        port: 0,
        tls: { key, cert },
        artifacts,
      })

      try {
        const bytes = await new Promise<Buffer>((resolve, reject) => {
          get(
            `https://127.0.0.1:${(server.address as AddressInfo).port}/runtime-artifacts/token/hash.tgz`,
            { ca: cert },
            response => {
              const chunks: Buffer[] = []
              response.on("data", chunk => chunks.push(chunk))
              response.on("end", () => resolve(Buffer.concat(chunks)))
              response.on("error", reject)
            },
          ).on("error", reject)
        })

        expect(bytes.toString()).toBe("archive")
      } finally {
        await server.shutdown()
      }
    },
  )

  it("returns gRPC authentication failures", async () => {
    const coordinator = fixture()

    const server = await startRuntimeServer(coordinator as unknown as RuntimeCoordinator, {
      host: "127.0.0.1",
      port: 0,
      tls: { key, cert },
    })

    try {
      const client = createClient(
        RuntimeService,
        createGrpcTransport({
          baseUrl: `https://127.0.0.1:${(server.address as AddressInfo).port}`,
          nodeOptions: { ca: cert },
        }),
      )

      const requests = {
        async *[Symbol.asyncIterator]() {
          yield create(ConnectRequestSchema)
        },
      }

      const stream = client.connect(requests)[Symbol.asyncIterator]()
      await expect(stream.next()).rejects.toMatchObject({ code: Code.Unauthenticated })
      expect(coordinator.connect).not.toHaveBeenCalled()
    } finally {
      await server.shutdown()
    }
  })

  it("requires TLS key material before binding", async () => {
    await expect(
      startRuntimeServer(fixture() as unknown as RuntimeCoordinator, { port: 0, tls: {} }),
    ).rejects.toThrow("TLS key and certificate are required")
  })
})
