import type {
  AgentConnection,
  RuntimeCoordinator,
  RuntimeCredentialSigner,
  WorkerProxyChannel,
  WorkerProxyRegistry,
} from "../container-runtime"
import { describe, expect, test, vi } from "vitest"
import { createWorkerProxyHandler, type WorkerProxyInput, type WorkerProxyOutput } from "./proxy"

describe("reverse worker proxy", () => {
  test("streams request EOF independently from response completion and preserves binary and repeated headers", async () => {
    const scope = {
      backendId: "backend",
      projectId: "project",
      runtimeId: "runtime",
      workloadId: "workload",
      kind: "worker",
      generation: 2,
    }
    const connection = { scope } as AgentConnection
    const coordinator = {
      connections: { current: () => connection },
      authenticate: vi.fn(),
    } as unknown as RuntimeCoordinator
    const signer = { verify: vi.fn(() => scope) } as unknown as RuntimeCredentialSigner
    let channel: WorkerProxyChannel | undefined
    const proxies = {
      register: vi.fn(async (_connection, value) => {
        channel = value
      }),
    } as unknown as WorkerProxyRegistry
    let responseReady: (() => void) | undefined
    const responseWait = new Promise<void>(resolve => {
      responseReady = resolve
    })
    async function* input(): AsyncGenerator<WorkerProxyInput> {
      yield { event: { case: "ready", value: { workloadId: "workload", leaseGeneration: 2n } } }
      await responseWait
      yield {
        event: {
          case: "head",
          value: {
            statusCode: 201,
            headers: [
              { name: "set-cookie", value: "a=1" },
              { name: "set-cookie", value: "b=2" },
            ],
          },
        },
      }
      yield { event: { case: "body", value: new Uint8Array([0, 255, 128]) } }
    }
    const handler = createWorkerProxyHandler(coordinator, proxies, signer, frame => frame)
    const frames: WorkerProxyOutput[] = []
    const transport = (async () => {
      for await (const frame of handler(input(), {
        requestHeader: new Headers({ authorization: "Bearer runtime-token" }),
        signal: new AbortController().signal,
      })) {
        frames.push(frame)
        if (frame.event.case === "body" && !frame.event.value.length) responseReady!()
      }
    })()
    await vi.waitFor(() => expect(channel).toBeDefined())
    const response = await channel!.request({
      method: "POST",
      path: "/route?q=a%2Fb",
      stateId: "state",
      panelName: "panel",
      headers: [
        { name: "x-repeat", value: "a" },
        { name: "x-repeat", value: "b" },
      ],
      body: (async function* () {
        yield new Uint8Array([1, 0, 255])
      })(),
    })
    expect(response.status).toBe(201)
    expect(response.headers).toEqual([
      { name: "set-cookie", value: "a=1" },
      { name: "set-cookie", value: "b=2" },
    ])
    const chunks = []
    for await (const chunk of response.body) chunks.push([...chunk])
    await transport
    expect(chunks).toEqual([[0, 255, 128]])
    expect(frames[0]!.event).toMatchObject({
      case: "head",
      value: { path: "/route?q=a%2Fb", stateId: "state", panelName: "panel" },
    })
    expect(
      frames.slice(1).map(frame => (frame.event.case === "body" ? [...frame.event.value] : null)),
    ).toEqual([[1, 0, 255], []])
  })
})
