import type { HandlerContext } from "@connectrpc/connect"
import type { AgentConnection, AgentTransport, RuntimeCoordinator } from "@highstate/backend"
import { create, toJson } from "@bufbuild/protobuf"
import { Code } from "@connectrpc/connect"
import {
  ConnectRequestSchema,
  ConnectResponseSchema,
  WorkloadKind,
} from "@highstate/api/runtime.v1"
import { describe, expect, it, vi } from "vitest"
import { createRuntimeService, decodeEvent, encodeCommand } from "./runtime"

function runtimeFixture() {
  let transport: AgentTransport
  const connection = { scope: { workloadId: "workload", generation: 2 } } as AgentConnection

  const coordinator = {
    leaseDurationMs: 30_000,
    connect: vi.fn(async (_token, _hello, value: AgentTransport) => {
      transport = value
      return connection
    }),
    authenticate: vi.fn(async () => ({})),
    receive: vi.fn(async () => {}),
    disconnected: vi.fn(async () => {}),
  }

  const controller = new AbortController()

  const context = {
    requestHeader: new Headers({ authorization: "Bearer runtime-token" }),
    signal: controller.signal,
  } as HandlerContext

  return { coordinator, connection, context, controller, transport: () => transport }
}

function hello() {
  return create(ConnectRequestSchema, {
    event: {
      case: "clientHello",
      value: {
        minimumProtocolVersion: 1,
        maximumProtocolVersion: 1,
        backendId: "backend",
        projectId: "project",
        containerRuntimeId: "runtime",
        workloadId: "workload",
        workloadKind: WorkloadKind.PULUMI,
        leaseGeneration: 2n,
      },
    },
  })
}

async function* input(...messages: ReturnType<typeof hello>[]) {
  yield* messages
}

describe("runtime control transport", () => {
  it("requires bearer authentication and a first uncorrelated hello", async () => {
    const f = runtimeFixture()
    const service = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator)
    f.context.requestHeader.set("authorization", "Basic runtime-token")

    await expect(
      service.connect(input(hello()), f.context)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: Code.Unauthenticated })

    f.context.requestHeader.set("authorization", "Bearer runtime-token")

    await expect(
      service
        .connect(input(create(ConnectRequestSchema)), f.context)
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })

    const correlated = hello()
    correlated.actionId = ""

    await expect(
      service.connect(input(correlated), f.context)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: Code.InvalidArgument })

    expect(f.coordinator.connect).not.toHaveBeenCalled()
  })

  it("maps hello scope exactly and rejects failed credential validation", async () => {
    const f = runtimeFixture()
    f.coordinator.connect.mockRejectedValueOnce(new Error("Invalid signature"))

    const stream = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator).connect(
      input(hello()),
      f.context,
    )

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: Code.Unauthenticated,
    })

    expect(f.coordinator.connect).toHaveBeenCalledWith(
      "runtime-token",
      {
        backendId: "backend",
        projectId: "project",
        runtimeId: "runtime",
        workloadId: "workload",
        kind: "pulumi",
        generation: 2,
        minimumProtocolVersion: 1,
        maximumProtocolVersion: 1,
      },
      expect.any(Object),
    )
  })

  it("sends ServerHello first, awaits consumer backpressure and rejects in-flight sends on close", async () => {
    const f = runtimeFixture()

    const source = {
      async *[Symbol.asyncIterator]() {
        yield hello()
        await new Promise(() => {})
      },
    }

    const stream = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator, {
      maxPendingSends: 1,
    })
      .connect(source, f.context)
      [Symbol.asyncIterator]()

    expect((await stream.next()).value?.event.case).toBe("serverHello")
    const sent = f.transport().send({ type: "cancel", actionId: "a", requestId: "r", force: true })
    const observed = vi.fn()
    void sent.then(observed, observed)
    const command = await stream.next()

    expect(command.value).toMatchObject({
      actionId: "a",
      requestId: "r",
      event: { case: "cancelRequest", value: { force: true } },
    })

    expect(observed).not.toHaveBeenCalled()

    await expect(f.transport().send({ type: "cancel", force: false })).rejects.toMatchObject({
      code: Code.ResourceExhausted,
    })

    f.transport().close(new Error("Lease replaced"))
    await expect(sent).rejects.toThrow("Lease replaced")
    await expect(stream.next()).rejects.toMatchObject({ code: Code.FailedPrecondition })
    expect(f.coordinator.disconnected).toHaveBeenCalledWith(f.connection)
  })

  it("routes request and action IDs and byte output to the coordinator before accepting another event", async () => {
    const f = runtimeFixture()

    const event = create(ConnectRequestSchema, {
      actionId: "action",
      requestId: "request",
      event: { case: "actionOutput", value: { data: new Uint8Array([0, 255]) } },
    })

    const stream = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator)
      .connect(input(hello(), event), f.context)
      [Symbol.asyncIterator]()

    await stream.next()
    await stream.next()

    expect(f.coordinator.receive).toHaveBeenCalledWith(
      f.connection,
      expect.objectContaining({
        actionId: "action",
        requestId: "request",
        type: "output",
        payload: expect.objectContaining({ data: Buffer.from([0, 255]) }),
      }),
    )

    expect(f.coordinator.disconnected).toHaveBeenCalledOnce()
  })

  it("rejects an unacknowledged send when the response consumer returns at yield", async () => {
    const f = runtimeFixture()

    const source = {
      async *[Symbol.asyncIterator]() {
        yield hello()
        await new Promise(() => {})
      },
    }

    const stream = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator)
      .connect(source, f.context)
      [Symbol.asyncIterator]()

    await stream.next()
    const sent = f.transport().send({ type: "cancel", actionId: "a", force: false })
    void sent.catch(() => {})
    await stream.next()
    await stream.return?.()
    await expect(sent).rejects.toThrow("Runtime response consumer closed")
    expect(f.coordinator.disconnected).toHaveBeenCalledOnce()
  })

  it("rejects duplicate hello and lossy heartbeat sequences", () => {
    expect(() => decodeEvent({ clientHello: {} })).toThrow("Duplicate ClientHello")

    expect(() => decodeEvent({ heartbeat: { sequence: "9007199254740993" } })).toThrow(
      "Invalid runtime heartbeat",
    )

    expect(() => decodeEvent({ heartbeat: {}, actionId: "a" })).toThrow("Invalid runtime heartbeat")
    expect(decodeEvent({ heartbeat: {} })).toEqual({ type: "heartbeat", sequence: 0 })
  })

  it("encodes typed worker control changes and retains structured unit secrets and input provenance", () => {
    const registration = encodeCommand({
      type: "workerControl",
      control: { type: "register", stateId: "state", params: { nested: { enabled: true } } },
    })

    expect(toJson(ConnectResponseSchema, registration)).toEqual({
      workerControl: {
        unitRegistration: { stateId: "state", params: { nested: { enabled: true } } },
      },
    })

    expect(
      toJson(
        ConnectResponseSchema,
        encodeCommand({ type: "workerControl", control: { type: "deregister", stateId: "state" } }),
      ),
    ).toEqual({ workerControl: { unitDeregistration: { stateId: "state" } } })

    expect(
      toJson(
        ConnectResponseSchema,
        encodeCommand({ type: "workerControl", control: { type: "stop" } }),
      ),
    ).toEqual({ workerControl: { stop: {} } })

    const config = {
      args: { nested: [1, false] },
      secretValues: { credential: { username: "user", token: "secret" } },
      inputs: {
        source: [{ value: { data: "value" }, source: { instanceId: "source", output: "data" } }],
      },
      instanceId: "instance",
      stateId: "state",
      invokedTriggers: [{ name: "deploy" }],
      importBasePath: "/library/package.json",
    }

    expect(
      toJson(
        ConnectResponseSchema,
        encodeCommand({ type: "response", actionId: "a", requestId: "r", payload: config }),
      ),
    ).toEqual({
      actionId: "a",
      requestId: "r",
      unitConfigurationResponse: { ...config, args: undefined, arguments: config.args },
    })
  })

  it("encodes domain resolved-input types rather than losing them in evaluation requests", () => {
    const result = encodeCommand({
      type: "evaluate",
      actionId: "a",
      payload: {
        instances: [],
        virtualComponents: {},
        librarySnapshotId: "snapshot",
        modelRevision: "revision",
        resolvedInputs: {
          target: {
            source: [
              { input: { instanceId: "source", output: "data" }, type: "example.entity.v1" },
            ],
          },
        },
      },
    })

    expect(result.event).toMatchObject({
      case: "compositeEvaluationRequest",
      value: {
        resolvedInputs: [
          {
            instanceId: "target",
            inputs: [
              {
                name: "source",
                values: [
                  {
                    entityType: "example.entity.v1",
                    reference: { instanceId: "source", output: "data" },
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  })

  it("checks idle lease fences and fails a waiting response when the lease expires", async () => {
    const f = runtimeFixture()

    const source = {
      async *[Symbol.asyncIterator]() {
        yield hello()
        await new Promise(() => {})
      },
    }

    const stream = createRuntimeService(f.coordinator as unknown as RuntimeCoordinator, {
      leaseCheckIntervalMs: 1,
    })
      .connect(source, f.context)
      [Symbol.asyncIterator]()

    await stream.next()
    f.coordinator.authenticate.mockRejectedValue(new Error("Expired lease"))
    await expect(stream.next()).rejects.toMatchObject({ code: Code.FailedPrecondition })
    expect(f.coordinator.disconnected).toHaveBeenCalledOnce()
  })
})
