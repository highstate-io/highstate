import type { MessageShape } from "@bufbuild/protobuf"
import type { ClientDuplexStream } from "@grpc/grpc-js"
import type { PanelTargetRegistry } from "./panel"
import { fromBinary, toBinary } from "@bufbuild/protobuf"
import { Client, credentials, Metadata } from "@grpc/grpc-js"
import {
  ConnectRequestSchema,
  ConnectResponseSchema,
  ProxyWorkerRequestSchema,
  ProxyWorkerResponseSchema,
} from "@highstate/api/runtime.v1"
import { proxyPanelRequest } from "./panel"

export type WorkerRuntimeConfig = {
  runtimeApiUrl: string
  runtimeApiCaBundle?: string
  runtimeToken: string
  scope: {
    backendId: string
    projectId: string
    runtimeId: string
    workloadId: string
    generation: number
  }
  workerVersionId: string
  workerInstanceId: string
}

async function write<T, U>(stream: ClientDuplexStream<T, U>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    stream.write(value, (error?: Error | null) => (error ? reject(error) : resolve())),
  )
}

/**
 * One control stream and a fixed pool of dedicated, one-request reverse HTTP RPCs.
 */
export class WorkerRuntimeClient {
  private readonly client: Client
  private readonly calls = new Set<{ cancel(): void }>()

  constructor(
    private readonly config: WorkerRuntimeConfig,
    private readonly targets: PanelTargetRegistry,
  ) {
    const url = new URL(config.runtimeApiUrl)
    if (url.protocol !== "https:") {
      throw new Error("Worker runtime API requires TLS")
    }

    this.client = new Client(
      url.host,
      credentials.createSsl(
        config.runtimeApiCaBundle ? Buffer.from(config.runtimeApiCaBundle) : undefined,
      ),
      {
        "grpc.max_receive_message_length": 128 * 1024,
        "grpc.max_send_message_length": 128 * 1024,
      },
    )
  }

  close(): void {
    for (const call of this.calls) {
      call.cancel()
    }

    this.client.close()
  }

  private metadata(): Metadata {
    const metadata = new Metadata()
    metadata.set("authorization", `Bearer ${this.config.runtimeToken}`)
    return metadata
  }

  async connect(
    onControl: (
      event:
        | { type: "register"; stateId: string; params: unknown }
        | { type: "deregister"; stateId: string }
        | { type: "stop" },
    ) => Promise<void>,
  ): Promise<void> {
    const call = this.client.makeBidiStreamRequest<
      MessageShape<typeof ConnectRequestSchema>,
      MessageShape<typeof ConnectResponseSchema>
    >(
      "/io.highstate.runtime.v1.RuntimeService/Connect",
      value => Buffer.from(toBinary(ConnectRequestSchema, value)),
      value => fromBinary(ConnectResponseSchema, value),
      this.metadata(),
    )

    this.calls.add(call)
    call.on("error", () => {})
    const { scope } = this.config
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const proxies = new AbortController()

    try {
      await write(call, {
        $typeName: "io.highstate.runtime.v1.ConnectRequest",
        event: {
          case: "clientHello",
          value: {
            $typeName: "io.highstate.runtime.v1.ClientHello",
            minimumProtocolVersion: 1,
            maximumProtocolVersion: 1,
            backendId: scope.backendId,
            projectId: scope.projectId,
            containerRuntimeId: scope.runtimeId,
            workloadId: scope.workloadId,
            workloadKind: 2,
            capabilities: [4],
            leaseGeneration: BigInt(scope.generation),
          },
        },
      })

      let accepted = false

      for await (const response of call as AsyncIterable<
        MessageShape<typeof ConnectResponseSchema>
      >) {
        const event = response.event

        if (!accepted) {
          if (
            event.case !== "serverHello" ||
            event.value.protocolVersion !== 1 ||
            event.value.leaseGeneration !== BigInt(scope.generation)
          ) {
            throw new Error("Invalid runtime handshake")
          }

          accepted = true
          let sequence = 0n

          const beat = async () =>
            await write(call, {
              $typeName: "io.highstate.runtime.v1.ConnectRequest",
              event: {
                case: "heartbeat",
                value: { $typeName: "io.highstate.runtime.v1.Heartbeat", sequence: sequence++ },
              },
            })

          heartbeat = setInterval(
            () => {
              void beat().catch(() => call.cancel())
            },
            Math.max(100, Number(event.value.leaseDurationMs) / 3),
          )

          await beat()

          await write(call, {
            $typeName: "io.highstate.runtime.v1.ConnectRequest",
            event: {
              case: "workerRegistration",
              value: {
                $typeName: "io.highstate.runtime.v1.WorkerRegistration",
                workerVersionId: this.config.workerVersionId,
                workerInstanceId: this.config.workerInstanceId,
              },
            },
          })

          for (let index = 0; index < 4; index++) {
            void this.proxyLoop(proxies.signal).catch(() => call.cancel())
          }

          continue
        }

        if (event.case === "workerControl") {
          const control = event.value.event
          if (control.case === "unitRegistration") {
            await onControl({
              type: "register",
              stateId: control.value.stateId,
              params: control.value.params,
            })
          } else if (control.case === "unitDeregistration") {
            await onControl({ type: "deregister", stateId: control.value.stateId })
          } else if (control.case === "stop") {
            await onControl({ type: "stop" })
            return
          }
        } else if (event.case === "error") {
          throw new Error(event.value.message)
        }
      }

      throw new Error("Runtime connection closed")
    } finally {
      clearInterval(heartbeat)
      proxies.abort()
      call.cancel()
      this.calls.delete(call)
    }
  }

  private async proxyLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.proxy(signal)
      } catch {
        if (!signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
    }
  }

  private async proxy(signal: AbortSignal): Promise<void> {
    const call = this.client.makeBidiStreamRequest<
      MessageShape<typeof ProxyWorkerRequestSchema>,
      MessageShape<typeof ProxyWorkerResponseSchema>
    >(
      "/io.highstate.runtime.v1.RuntimeService/ProxyWorker",
      value => Buffer.from(toBinary(ProxyWorkerRequestSchema, value)),
      value => fromBinary(ProxyWorkerResponseSchema, value),
      this.metadata(),
    )

    this.calls.add(call)
    const controller = new AbortController()
    const status = new Promise<number>(resolve => call.once("status", value => resolve(value.code)))

    const cancel = () => {
      controller.abort()
      call.cancel()
    }

    signal.addEventListener("abort", cancel, { once: true })
    call.on("error", () => controller.abort())

    try {
      await write(call, {
        $typeName: "io.highstate.runtime.v1.ProxyWorkerRequest",
        event: {
          case: "ready",
          value: {
            $typeName: "io.highstate.runtime.v1.WorkerProxyReady",
            workloadId: this.config.scope.workloadId,
            leaseGeneration: BigInt(this.config.scope.generation),
          },
        },
      })

      const iterator = (call as AsyncIterable<MessageShape<typeof ProxyWorkerResponseSchema>>)[
        Symbol.asyncIterator
      ]()

      const first = await iterator.next()
      if (first.done || first.value.event.case !== "head") {
        throw new Error("Missing panel request headers")
      }

      const head = first.value.event.value
      if (!head.path.startsWith("/") || head.path.startsWith("//")) {
        throw new Error("Invalid panel request path")
      }

      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const next = await iterator.next()
              if (next.done) {
                controller.close()
                return
              }

              if (next.value.event.case !== "body" || next.value.event.value.byteLength > 65536) {
                throw new Error("Invalid panel body chunk")
              }

              if (!next.value.event.value.byteLength) {
                controller.close()
                return
              }

              controller.enqueue(next.value.event.value)
            } catch (error) {
              controller.error(error)
            }
          },
          cancel,
        },
        { highWaterMark: 1 },
      )

      const headers = new Headers()

      for (const header of head.headers) {
        headers.append(header.name, header.value)
      }

      const request = new Request(`http://panel.invalid${head.path}`, {
        method: head.method,
        headers,
        signal: controller.signal,
        ...(!["GET", "HEAD"].includes(head.method) ? { body, duplex: "half" } : {}),
      })

      const response = await proxyPanelRequest(this.targets, head.stateId, head.panelName, request)
      const responseHeaders: { name: string; value: string }[] = []

      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") {
          responseHeaders.push({ name, value })
        }
      })

      for (const value of response.headers.getSetCookie()) {
        responseHeaders.push({ name: "set-cookie", value })
      }

      await write(call, {
        $typeName: "io.highstate.runtime.v1.ProxyWorkerRequest",
        event: {
          case: "head",
          value: {
            $typeName: "io.highstate.runtime.v1.WorkerProxyResponseHead",
            statusCode: response.status,
            headers: responseHeaders.map(header => ({
              $typeName: "io.highstate.runtime.v1.ProxyHeader" as const,
              ...header,
            })),
          },
        },
      })

      if (response.body) {
        const reader = response.body.getReader()

        try {
          for (;;) {
            const { done, value } = await reader.read()

            if (done) {
              break
            }

            for (let offset = 0; offset < value.byteLength; offset += 65536) {
              await write(call, {
                $typeName: "io.highstate.runtime.v1.ProxyWorkerRequest",
                event: { case: "body", value: value.subarray(offset, offset + 65536) },
              })
            }
          }
        } finally {
          await reader.cancel()
          reader.releaseLock()
        }
      }

      call.end()

      // drain the request half even when an interceptor responds without consuming it
      for (;;) {
        if ((await iterator.next()).done) {
          break
        }
      }

      if ((await status) !== 0) {
        throw new Error("Panel reverse RPC failed")
      }
    } finally {
      signal.removeEventListener("abort", cancel)
      cancel()
      this.calls.delete(call)
    }
  }
}
