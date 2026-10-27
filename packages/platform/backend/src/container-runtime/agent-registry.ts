import type { RuntimeCredential } from "./credentials"
import { randomUUID } from "node:crypto"
import { abortable } from "./contracts"

export type WorkerControl =
  | { type: "register"; stateId: string; params: Record<string, unknown> }
  | { type: "deregister"; stateId: string }
  | { type: "stop"; reason?: string }
export type AgentCommand = {
  actionId?: string
  requestId?: string
} & (
  | { type: "pulumiAction"; payload: unknown }
  | { type: "evaluate"; payload: unknown }
  | { type: "cancel"; force: boolean }
  | { type: "response"; payload: unknown }
  | { type: "workerControl"; control: WorkerControl }
)
export type AgentEvent = { actionId?: string; requestId?: string } & (
  | { type: "heartbeat"; sequence: number }
  | {
      type:
        | "output"
        | "engineEvent"
        | "unitConfiguration"
        | "unitResult"
        | "createSidecar"
        | "workerRegistration"
      payload: unknown
    }
  | { type: "completed"; exitCode: number; result?: unknown }
  | { type: "evaluationResult"; result: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "cancelResponse"; accepted: boolean }
)
export interface AgentTransport {
  /** Must await transport backpressure, and reject when the connection closes. */
  send(command: AgentCommand): Promise<void>
  close(reason: Error): void
}
export type AgentConnection = {
  id: string
  scope: RuntimeCredential
  transport: AgentTransport
  heartbeatSequence: number
}

/** Holds only live streams; persisted actions remain the authority across restarts. */
export class AgentConnectionRegistry {
  private readonly invalidationListeners = new Set<(workloadId: string) => void>()
  private readonly connections = new Map<string, AgentConnection>()
  private readonly waiters = new Map<string, Set<(connection: AgentConnection) => void>>()
  private readonly sending = new Map<string, number>()
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly maxPendingSends = 32) {}

  register(scope: RuntimeCredential, transport: AgentTransport): AgentConnection {
    this.invalidate(scope.workloadId, new Error("Runtime connection replaced"))
    const connection = { id: randomUUID(), scope, transport, heartbeatSequence: -1 }
    this.connections.set(scope.workloadId, connection)
    for (const resolve of this.waiters.get(scope.workloadId) ?? []) resolve(connection)
    this.waiters.delete(scope.workloadId)
    return connection
  }

  current(workloadId: string): AgentConnection | undefined {
    return this.connections.get(workloadId)
  }

  assertCurrent(connection: AgentConnection): void {
    if (this.connections.get(connection.scope.workloadId) !== connection)
      throw new Error("Stale runtime stream")
  }

  invalidate(workloadId: string, reason: Error): void {
    const connection = this.connections.get(workloadId)
    this.connections.delete(workloadId)
    connection?.transport.close(reason)
    for (const listener of this.invalidationListeners) listener(workloadId)
  }

  onInvalidated(listener: (workloadId: string) => void): () => void {
    this.invalidationListeners.add(listener)
    return () => this.invalidationListeners.delete(listener)
  }

  async wait(workloadId: string, signal?: AbortSignal): Promise<AgentConnection> {
    const current = this.current(workloadId)
    if (current) return current
    const waiters = this.waiters.get(workloadId) ?? new Set()
    this.waiters.set(workloadId, waiters)
    let resolve: (connection: AgentConnection) => void = () => {}
    const pending = new Promise<AgentConnection>(done => {
      resolve = done
      waiters.add(done)
    })
    try {
      return await abortable(pending, signal)
    } finally {
      waiters.delete(resolve)
      if (!waiters.size) this.waiters.delete(workloadId)
    }
  }

  async send(
    connection: AgentConnection,
    command: AgentCommand,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertCurrent(connection)
    const pending = this.sending.get(connection.id) ?? 0
    if (pending >= this.maxPendingSends) throw new Error("Runtime control send queue is full")
    this.sending.set(connection.id, pending + 1)
    const previous = this.tails.get(connection.id) ?? Promise.resolve()
    const sending = previous
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted()
        this.assertCurrent(connection)
        await connection.transport.send(command)
        this.assertCurrent(connection)
      })
    this.tails.set(connection.id, sending)
    void sending
      .finally(() => {
        const count = (this.sending.get(connection.id) ?? 1) - 1
        if (count) this.sending.set(connection.id, count)
        else this.sending.delete(connection.id)
        if (this.tails.get(connection.id) === sending) this.tails.delete(connection.id)
      })
      .catch(() => {})
    await abortable(sending, signal)
  }
}

export type ProxyHeader = { name: string; value: string }
export type WorkerProxyRequest = {
  method: string
  path: string
  stateId: string
  panelName: string
  headers: ProxyHeader[]
  body: AsyncIterable<Uint8Array>
}
export type WorkerProxyResponse = {
  status: number
  headers: ProxyHeader[]
  body: AsyncIterable<Uint8Array>
}
export interface WorkerProxyChannel {
  /** Implements one dedicated ProxyWorker RPC, awaiting writes and reads without buffering whole bodies. */
  request(request: WorkerProxyRequest, signal?: AbortSignal): Promise<WorkerProxyResponse>
  close(reason?: Error): void
}

/** A bounded reverse-channel pool; control traffic never carries HTTP body bytes. */
export class WorkerProxyRegistry {
  private readonly allChannels = new Map<string, Set<WorkerProxyChannel>>()
  private readonly channels = new Map<
    string,
    { connection: AgentConnection; channel: WorkerProxyChannel }[]
  >()
  constructor(
    private readonly agents: AgentConnectionRegistry,
    private readonly authenticate: (connection: AgentConnection) => Promise<void>,
    private readonly maxIdle = 8,
  ) {
    this.agents.onInvalidated(workloadId => this.invalidate(workloadId))
  }

  async register(connection: AgentConnection, channel: WorkerProxyChannel): Promise<void> {
    await this.authenticate(connection)
    this.agents.assertCurrent(connection)
    if (connection.scope.kind !== "worker" || !connection.scope.permissions.includes("proxy"))
      throw new Error("Runtime proxy scope denied")
    const pool = this.channels.get(connection.scope.workloadId) ?? []
    if (pool.length >= this.maxIdle) {
      channel.close()
      throw new Error("Worker proxy channel pool is full")
    }
    pool.push({ connection, channel })
    const all = this.allChannels.get(connection.scope.workloadId) ?? new Set<WorkerProxyChannel>()
    all.add(channel)
    this.allChannels.set(connection.scope.workloadId, all)
    this.channels.set(connection.scope.workloadId, pool)
  }

  invalidate(workloadId: string): void {
    for (const channel of this.allChannels.get(workloadId) ?? [])
      channel.close(new Error("Worker lease invalidated"))
    this.allChannels.delete(workloadId)
    this.channels.delete(workloadId)
  }

  async request(
    workloadId: string,
    request: WorkerProxyRequest,
    signal?: AbortSignal,
  ): Promise<WorkerProxyResponse> {
    const pool = this.channels.get(workloadId)
    let item = pool?.shift()
    while (item && this.agents.current(workloadId) !== item.connection) {
      item.channel.close()
      item = pool?.shift()
    }
    if (!item) throw new Error("No worker proxy channel available")
    const { connection, channel } = item
    const release = () => {
      channel.close()
      this.allChannels.get(workloadId)?.delete(channel)
    }
    const validate = async () => {
      signal?.throwIfAborted()
      this.agents.assertCurrent(connection)
      await this.authenticate(connection)
    }
    async function* checked(body: AsyncIterable<Uint8Array>) {
      for await (const chunk of body) {
        await validate()
        if (chunk.byteLength > 65536) throw new Error("Worker proxy chunk exceeds 64 KiB")
        yield chunk
      }
    }
    try {
      await validate()
      const response = await channel.request({ ...request, body: checked(request.body) }, signal)
      await validate()
      return {
        ...response,
        body: (async function* () {
          try {
            yield* checked(response.body)
          } finally {
            release()
          }
        })(),
      }
    } catch (error) {
      release()
      throw error
    }
  }
}
