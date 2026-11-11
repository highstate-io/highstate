import type { RuntimeOwnership } from "./contracts"
import { describe, expect, it, vi } from "vitest"
import { AgentConnectionRegistry, WorkerProxyRegistry } from "./agent-registry"
import { RuntimeCredentialSigner } from "./credentials"

const owner: RuntimeOwnership = {
  backendId: "backend",
  projectId: "project",
  runtimeId: "runtime",
  workloadId: "workload",
  kind: "worker",
  generation: 1,
}

describe("Runtime agent transport hooks", () => {
  it("authenticates signed runtime-only scope and expiry", () => {
    let now = 1000
    const signer = new RuntimeCredentialSigner("backend", new Uint8Array(32).fill(5), () => now)
    const token = signer.issue(owner, ["connect", "worker"], 2000)
    expect(signer.verify(token).projectId).toBe("project")
    expect(() => signer.verify(token, "sidecar")).toThrow(/scope/)

    expect(() =>
      new RuntimeCredentialSigner("other", new Uint8Array(32).fill(5), () => now).verify(token),
    ).toThrow(/scope/)

    expect(() => signer.verify(`${token.slice(0, -2)}zz`)).toThrow(/signature/)
    now = 2000
    expect(() => signer.verify(token)).toThrow(/expired/)
  })

  it("bounds queued sends and preserves order under backpressure", async () => {
    const registry = new AgentConnectionRegistry(2)

    const scope = {
      ...owner,
      audience: "highstate-runtime-v1" as const,
      permissions: ["connect" as const],
      expiresAt: Date.now() + 10000,
    }

    let release: () => void = () => {}

    const blocked = new Promise<void>(resolve => {
      release = resolve
    })

    const sent: string[] = []

    const connection = registry.register(scope, {
      close: () => {},
      send: async command => {
        sent.push(command.type)
        await blocked
      },
    })

    const first = registry.send(connection, {
      type: "workerControl",
      control: { type: "stop", reason: "test" },
    })

    const second = registry.send(connection, { type: "response", payload: "second" })

    await expect(
      registry.send(connection, { type: "response", payload: "overflow" }),
    ).rejects.toThrow(/full/)

    await Promise.resolve()
    expect(sent).toEqual(["workerControl"])
    release()
    await Promise.all([first, second])
    expect(sent).toEqual(["workerControl", "response"])
  })

  it("streams bounded HTTP chunks and rejects stale proxy streams", async () => {
    const agents = new AgentConnectionRegistry()

    const scope = {
      ...owner,
      audience: "highstate-runtime-v1" as const,
      permissions: ["connect" as const, "proxy" as const],
      expiresAt: Date.now() + 10000,
    }

    const connection = agents.register(scope, { send: async () => {}, close: () => {} })
    const proxies = new WorkerProxyRegistry(agents, async () => {})
    let reads = 0
    const close = vi.fn()

    await proxies.register(connection, {
      close,
      request: async request => {
        for await (const _chunk of request.body) {
          reads++
        }

        return {
          status: 200,
          headers: [
            { name: "set-cookie", value: "a=1" },
            { name: "set-cookie", value: "b=2" },
          ],
          body: (async function* () {
            yield new Uint8Array([1])
            yield new Uint8Array([2])
          })(),
        }
      },
    })

    const response = await proxies.request(owner.workloadId, {
      method: "POST",
      path: "/panel?x=1",
      stateId: "state",
      panelName: "panel",
      headers: [],
      body: (async function* () {
        yield new Uint8Array([3])
      })(),
    })

    expect(reads).toBe(1)
    expect(response.headers).toHaveLength(2)
    const iterator = response.body[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual(new Uint8Array([1]))
    agents.invalidate(owner.workloadId, new Error("Expired"))
    await expect(iterator.next()).rejects.toThrow(/stale/i)
    expect(close).toHaveBeenCalled()
  })
})
