import type { ServiceImpl } from "@connectrpc/connect"
import type {
  AgentCommand,
  AgentConnection,
  AgentEvent,
  RuntimeCoordinator,
} from "@highstate/backend"
import type { ComponentModel, InstanceModel } from "@highstate/contract"
import { create, fromJson, type JsonValue, toJson } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import {
  ConnectRequestSchema,
  type ConnectResponse,
  ConnectResponseSchema,
  type RuntimeService,
} from "@highstate/api/runtime.v1"
import { ComponentSchema, InstanceSchema } from "@highstate/api/v1"
import { fromInstance, toComponent, toInstance } from "../shared/conversion"

type Pending = { value: ConnectResponse; resolve(): void; reject(reason: unknown): void }

export type RuntimeServiceOptions = {
  proxyWorker?: ServiceImpl<typeof RuntimeService>["proxyWorker"]
  encodeCommand?: (command: AgentCommand) => ConnectResponse
  decodeEvent?: (envelope: Record<string, unknown>) => AgentEvent
  maxPendingSends?: number
  leaseCheckIntervalMs?: number
}

export function createRuntimeService(
  coordinator: RuntimeCoordinator,
  options: RuntimeServiceOptions | ServiceImpl<typeof RuntimeService>["proxyWorker"] = {},
): ServiceImpl<typeof RuntimeService> {
  const config = typeof options === "function" ? { proxyWorker: options } : options
  const maxPendingSends = config.maxPendingSends ?? 32
  const leaseCheckIntervalMs =
    config.leaseCheckIntervalMs ?? Math.max(1, Math.floor(coordinator.leaseDurationMs / 3))
  if (
    !Number.isSafeInteger(maxPendingSends) ||
    maxPendingSends < 1 ||
    !Number.isSafeInteger(leaseCheckIntervalMs) ||
    leaseCheckIntervalMs < 1
  )
    throw new Error("Invalid runtime transport limits")

  return {
    async *connect(requests, context) {
      const token = /^Bearer ([^\s]+)$/i.exec(context.requestHeader.get("authorization") ?? "")?.[1]
      if (!token) throw new ConnectError("Missing runtime credential", Code.Unauthenticated)
      const iterator = requests[Symbol.asyncIterator]()
      const kinds: Record<number, string> = { 1: "pulumi", 2: "worker", 3: "composite_evaluation" }
      let wake: (() => void) | undefined
      let closed = false
      let failure: unknown
      const queue: Pending[] = []
      let inFlight: Pending | undefined
      let connection: AgentConnection | undefined
      let leaseCheck: ReturnType<typeof setInterval> | undefined
      const close = (reason?: unknown) => {
        if (closed) return
        closed = true
        failure = reason
        inFlight?.reject(reason ?? new Error("Runtime stream closed"))
        for (const pending of queue.splice(0))
          pending.reject(reason ?? new Error("Runtime stream closed"))
        wake?.()
      }
      const aborted = () =>
        close(
          new ConnectError(
            "Runtime stream cancelled",
            Code.Canceled,
            undefined,
            undefined,
            context.signal.reason,
          ),
        )
      context.signal.addEventListener("abort", aborted, { once: true })
      if (context.signal.aborted) aborted()
      try {
        const first = await iterator.next()
        if (closed) throw failure
        if (
          first.done ||
          first.value.event.case !== "clientHello" ||
          first.value.actionId !== undefined ||
          first.value.requestId !== undefined
        )
          throw new ConnectError(
            "ClientHello must be the first runtime message",
            Code.InvalidArgument,
          )
        const hello = first.value.event.value
        if (
          !kinds[hello.workloadKind] ||
          hello.leaseGeneration > BigInt(Number.MAX_SAFE_INTEGER) ||
          hello.minimumProtocolVersion < 1 ||
          hello.maximumProtocolVersion < hello.minimumProtocolVersion
        )
          throw new ConnectError("Invalid runtime hello", Code.InvalidArgument)

        try {
          connection = await coordinator.connect(
            token,
            {
              backendId: hello.backendId,
              projectId: hello.projectId,
              runtimeId: hello.containerRuntimeId,
              workloadId: hello.workloadId,
              kind: kinds[hello.workloadKind] ?? "unknown",
              generation: Number(hello.leaseGeneration),
              minimumProtocolVersion: hello.minimumProtocolVersion,
              maximumProtocolVersion: hello.maximumProtocolVersion,
            },
            {
              async send(command) {
                if (closed) throw new Error("Runtime stream closed")
                if (queue.length + (inFlight ? 1 : 0) >= maxPendingSends)
                  throw new ConnectError("Runtime outgoing queue is full", Code.ResourceExhausted)
                const value = (config.encodeCommand ?? encodeCommand)(command)
                await new Promise<void>((resolve, reject) => {
                  queue.push({ value, resolve, reject })
                  wake?.()
                })
              },
              close,
            },
          )
        } catch (error) {
          throw new ConnectError(
            "Runtime authentication failed",
            Code.Unauthenticated,
            undefined,
            undefined,
            error,
          )
        }
        if (closed) throw failure
        const active = connection
        let checking = false
        leaseCheck = setInterval(() => {
          if (checking || closed) return
          checking = true
          void coordinator
            .authenticate(active)
            .catch(error =>
              close(
                new ConnectError(
                  "Runtime lease rejected",
                  Code.FailedPrecondition,
                  undefined,
                  undefined,
                  error,
                ),
              ),
            )
            .finally(() => {
              checking = false
            })
        }, leaseCheckIntervalMs)
        leaseCheck.unref()
        yield create(ConnectResponseSchema, {
          event: {
            case: "serverHello",
            value: {
              protocolVersion: 1,
              leaseDurationMs: BigInt(coordinator.leaseDurationMs),
              leaseGeneration: hello.leaseGeneration,
            },
          },
        })
        const receive = (async () => {
          while (!closed) {
            const next = await iterator.next()
            if (next.done) return
            if (closed) return
            await coordinator.receive(
              active,
              (config.decodeEvent ?? decodeEvent)(
                toJson(ConnectRequestSchema, next.value) as Record<string, unknown>,
              ),
            )
            if (active.scope.expiresAt - Date.now() < 60_000)
              await coordinator.refreshCredential(active)
          }
        })()
        void receive.then(() => close(), close)
        while (!closed) {
          if (!queue.length)
            await new Promise<void>(resolve => {
              wake = resolve
            })
          wake = undefined
          const pending = queue.shift()
          if (!pending) continue
          inFlight = pending
          try {
            await coordinator.authenticate(active)
            if (closed) throw failure ?? new Error("Runtime stream closed")
            yield pending.value
            if (closed) throw failure ?? new Error("Runtime stream closed")
            pending.resolve()
          } catch (error) {
            pending.reject(error)
            throw error
          } finally {
            // returning a response iterator injects return at yield, skipping the acknowledgement
            pending.reject(new Error("Runtime response consumer closed"))
            inFlight = undefined
          }
        }
        if (failure) throw failure
      } catch (error) {
        if (error instanceof ConnectError) throw error
        throw new ConnectError(
          "Runtime stream failed",
          Code.FailedPrecondition,
          undefined,
          undefined,
          error,
        )
      } finally {
        close()
        if (leaseCheck) clearInterval(leaseCheck)
        context.signal.removeEventListener("abort", aborted)
        try {
          if (connection) await coordinator.disconnected(connection)
        } finally {
          void iterator.return?.().catch(() => {})
        }
      }
    },
    proxyWorker:
      config.proxyWorker ??
      (() => {
        throw new ConnectError("Worker proxy handler is not configured", Code.Unimplemented)
      }),
  }
}

export function encodeCommand(command: AgentCommand): ConnectResponse {
  const envelope: Record<string, unknown> = {
    actionId: command.actionId,
    requestId: command.requestId,
  }
  if (command.type === "cancel") envelope.cancelRequest = { force: command.force }
  else if (command.type === "pulumiAction") {
    const payload = command.payload as Record<string, unknown>
    envelope.pulumiActionRequest = {
      ...payload,
      action: `PULUMI_ACTION_${String(payload.action).toUpperCase()}`,
    }
  } else if (command.type === "evaluate") {
    const payload = command.payload as {
      instances: InstanceModel[]
      virtualComponents: Record<string, ComponentModel>
      resolvedInputs: Record<string, Record<string, { input: unknown; type: string }[]>>
    }
    envelope.compositeEvaluationRequest = {
      ...payload,
      instances: payload.instances.map(instance => toJsonInstance(instance)),
      virtualComponents: Object.values(payload.virtualComponents).map(component =>
        toJson(ComponentSchema, toComponent(component)),
      ),
      resolvedInputs: Object.entries(payload.resolvedInputs).map(([instanceId, inputs]) => ({
        instanceId,
        inputs: Object.entries(inputs).map(([name, values]) => ({
          name,
          values: values.map(value => ({ reference: value.input, entityType: value.type })),
        })),
      })),
    }
    // use create for nested generated public models, then JSON for the final portable envelope
    const value = envelope.compositeEvaluationRequest as Record<string, unknown>
    delete value.projectId
  } else if (command.type === "response") {
    const payload = command.payload as Record<string, unknown>
    if (payload?.error) envelope.error = payload.error
    else if (payload && "host" in payload)
      envelope.createSidecarResponse = { ...payload, sidecarWorkloadId: payload.id }
    else envelope.unitConfigurationResponse = { ...payload, arguments: payload?.args }
  } else {
    const control = command.control
    envelope.workerControl =
      control.type === "register"
        ? { unitRegistration: { stateId: control.stateId, params: control.params } }
        : control.type === "deregister"
          ? { unitDeregistration: { stateId: control.stateId } }
          : { stop: {} }
  }
  return fromJson(ConnectResponseSchema, JSON.parse(JSON.stringify(envelope)) as JsonValue, {
    ignoreUnknownFields: true,
  })
}

function toJsonInstance(instance: InstanceModel): unknown {
  return toJson(InstanceSchema, toInstance(instance))
}

export function decodeEvent(envelope: Record<string, unknown>): AgentEvent {
  const ids = {
    actionId: envelope.actionId as string | undefined,
    requestId: envelope.requestId as string | undefined,
  }
  const data = (name: string) => envelope[name] as Record<string, unknown>
  if (envelope.clientHello) throw new ConnectError("Duplicate ClientHello", Code.InvalidArgument)
  if (envelope.heartbeat) {
    const sequence = Number(data("heartbeat").sequence ?? 0)
    if (
      ids.actionId !== undefined ||
      ids.requestId !== undefined ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    )
      throw new ConnectError("Invalid runtime heartbeat", Code.InvalidArgument)
    return { type: "heartbeat", sequence }
  }
  if (envelope.actionCompleted)
    return {
      ...ids,
      type: "completed",
      exitCode: Number(data("actionCompleted").exitCode ?? 0),
      result: data("actionCompleted").result,
    }
  if (envelope.error)
    return {
      ...ids,
      type: "error",
      code: String(data("error").code),
      message: String(data("error").message),
    }
  if (envelope.cancelResponse)
    return { ...ids, type: "cancelResponse", accepted: Boolean(data("cancelResponse").accepted) }
  if (envelope.actionOutput)
    return {
      ...ids,
      type: "output",
      payload: {
        ...data("actionOutput"),
        data: Buffer.from(String(data("actionOutput").data ?? ""), "base64"),
      },
    }
  if (envelope.compositeEvaluationResult) {
    const result = data("compositeEvaluationResult")
    const decoded = fromJson(ConnectRequestSchema, envelope as JsonValue).event
    if (decoded.case !== "compositeEvaluationResult") throw new Error("Invalid evaluation result")
    const outcome = decoded.value.outcome
    return {
      ...ids,
      type: "evaluationResult",
      result: {
        ...result,
        result:
          outcome.case === "success"
            ? {
                success: true,
                virtualInstances: outcome.value.virtualInstances.map(instance => ({
                  ...fromInstance(instance),
                  parentId: instance.parentId,
                  outputs: Object.fromEntries(
                    Object.entries(instance.outputs).map(([key, value]) => [key, value.values]),
                  ),
                  resolvedOutputs: Object.fromEntries(
                    Object.entries(instance.resolvedOutputs).map(([key, value]) => [
                      key,
                      value.values,
                    ]),
                  ),
                })),
                topLevelErrors: Object.fromEntries(
                  outcome.value.errors.map(error => [error.instanceId, error.message]),
                ),
              }
            : {
                success: false,
                error:
                  outcome.case === "failure" ? outcome.value.message : "Missing evaluation outcome",
              },
      },
    }
  }
  if (envelope.createSidecarRequest) {
    const payload = data("createSidecarRequest")
    const readiness = payload.readiness as Record<string, unknown> | undefined
    const check = readiness ? Object.entries(readiness)[0] : undefined
    return {
      ...ids,
      type: "createSidecar",
      payload: {
        ...payload,
        env: { ...(payload.environment as object), ...(payload.secretEnvironment as object) },
        readiness: check ? { type: check[0], ...(check[1] as object) } : undefined,
      },
    }
  }
  for (const [field, type] of [
    ["pulumiEngineEvent", "engineEvent"],
    ["unitConfigurationRequest", "unitConfiguration"],
    ["unitResult", "unitResult"],
    ["createSidecarRequest", "createSidecar"],
    ["workerRegistration", "workerRegistration"],
  ] as const)
    if (envelope[field]) return { ...ids, type, payload: envelope[field] }
  throw new ConnectError("Missing runtime event", Code.InvalidArgument)
}
