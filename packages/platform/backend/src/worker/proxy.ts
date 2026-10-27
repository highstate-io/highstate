import type {
  AgentConnection,
  RuntimeCoordinator,
  RuntimeCredentialSigner,
  WorkerProxyChannel,
  WorkerProxyRegistry,
  WorkerProxyRequest,
} from "../container-runtime"

export type WorkerProxyInput = {
  event:
    | { case: "ready"; value: { workloadId: string; leaseGeneration: bigint } }
    | { case: "head"; value: { statusCode: number; headers: { name: string; value: string }[] } }
    | { case: "body"; value: Uint8Array }
    | { case: undefined; value?: undefined }
}
export type WorkerProxyOutput = {
  event:
    | { case: "head"; value: Omit<WorkerProxyRequest, "body"> }
    | { case: "body"; value: Uint8Array }
}

/** Adapts a dedicated reverse RPC to the domain pool without importing a public transport. */
export function createWorkerProxyHandler<TOutput>(
  coordinator: RuntimeCoordinator,
  proxies: WorkerProxyRegistry,
  signer: RuntimeCredentialSigner,
  encode: (frame: WorkerProxyOutput) => TOutput,
  removeChannel?: (connection: AgentConnection, channel: WorkerProxyChannel) => void,
) {
  return async function* (
    requests: AsyncIterable<WorkerProxyInput>,
    context: { requestHeader: Headers; signal: AbortSignal },
  ): AsyncGenerator<TOutput> {
    const token = context.requestHeader.get("authorization")?.replace(/^Bearer /, "")
    if (!token) throw new Error("Missing worker proxy credential")
    const scope = signer.verify(token, "proxy")
    const iterator = requests[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.event.case !== "ready")
      throw new Error("Worker proxy readiness must be first")
    const ready = first.value.event.value
    const connection = coordinator.connections.current(scope.workloadId)
    if (
      !connection ||
      ready.workloadId !== scope.workloadId ||
      ready.leaseGeneration !== BigInt(scope.generation)
    )
      throw new Error("Worker proxy lease mismatch")
    for (const key of [
      "backendId",
      "projectId",
      "runtimeId",
      "workloadId",
      "kind",
      "generation",
    ] as const)
      if (scope[key] !== connection.scope[key])
        throw new Error("Worker proxy connection scope mismatch")
    await coordinator.authenticate(connection)
    let pending:
      | { frame: WorkerProxyOutput; resolve(): void; reject(error: unknown): void }
      | undefined
    let wake: (() => void) | undefined
    let closed = false
    let failure: Error | undefined
    let dispatched = false
    const close = (reason?: Error) => {
      if (closed) return
      closed = true
      failure = reason
      pending?.reject(reason ?? new Error("Worker proxy closed"))
      pending = undefined
      wake?.()
    }
    const send = async (frame: WorkerProxyOutput) => {
      if (closed) throw failure ?? new Error("Worker proxy closed")
      if (pending) throw new Error("Worker proxy output queue is full")
      await new Promise<void>((resolve, reject) => {
        pending = { frame, resolve, reject }
        wake?.()
      })
    }
    const channel: WorkerProxyChannel = {
      close,
      async request(request, signal) {
        if (closed || dispatched) throw new Error("Worker proxy channel is unavailable")
        dispatched = true
        signal?.throwIfAborted()
        const aborted = () => close(new Error("Panel request aborted"))
        signal?.addEventListener("abort", aborted, { once: true })
        const sending = (async () => {
          await send({
            event: {
              case: "head",
              value: {
                method: request.method,
                path: request.path,
                stateId: request.stateId,
                panelName: request.panelName,
                headers: request.headers,
              },
            },
          })
          for await (const chunk of request.body) {
            if (!chunk.byteLength) continue
            if (chunk.byteLength > 65536) throw new Error("Worker proxy chunk exceeds 64 KiB")
            await send({ event: { case: "body", value: chunk } })
          }
          // gRPC server completion ends the whole RPC; an empty frame terminates only the request body
          await send({ event: { case: "body", value: new Uint8Array() } })
        })()
        void sending.catch(error =>
          close(
            error instanceof Error
              ? error
              : new Error("Panel request body failed", { cause: error }),
          ),
        )
        try {
          const next = await iterator.next()
          if (next.done || next.value.event.case !== "head")
            throw new Error("Missing worker proxy response headers")
          const head = next.value.event.value
          if (!Number.isInteger(head.statusCode) || head.statusCode < 200 || head.statusCode > 599)
            throw new Error("Invalid worker proxy response status")
          return {
            status: head.statusCode,
            headers: head.headers,
            body: (async function* () {
              try {
                for (;;) {
                  const next = await iterator.next()
                  if (next.done) break
                  if (next.value.event.case !== "body" || next.value.event.value.byteLength > 65536)
                    throw new Error("Invalid worker proxy response body")
                  yield next.value.event.value
                }
                await sending
              } finally {
                signal?.removeEventListener("abort", aborted)
                close()
              }
            })(),
          }
        } catch (error) {
          signal?.removeEventListener("abort", aborted)
          close(error instanceof Error ? error : new Error("Worker proxy failed", { cause: error }))
          throw error
        }
      },
    }
    const aborted = () => close(new Error("Worker proxy transport closed"))
    context.signal.addEventListener("abort", aborted, { once: true })
    try {
      await proxies.register(connection, channel)
      while (!closed) {
        if (!pending)
          await new Promise<void>(resolve => {
            wake = resolve
          })
        wake = undefined
        const item = pending
        if (!item) continue
        pending = undefined
        try {
          yield encode(item.frame)
          item.resolve()
        } catch (error) {
          item.reject(error)
          throw error
        }
      }
      if (failure) throw failure
    } finally {
      context.signal.removeEventListener("abort", aborted)
      close()
      removeChannel?.(connection, channel)
      void iterator.return?.()
    }
  }
}
