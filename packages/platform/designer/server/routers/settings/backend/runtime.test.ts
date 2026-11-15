import assert from "node:assert/strict"
import { EventEmitter, on } from "node:events"
import { RuntimeSettingsConflictError, RuntimeSettingsInUseError } from "@highstate/backend/shared"
import { cuidv2d } from "@highstate/contract"
import { describe, expect, it, vi } from "vitest"
import { runtimeSettingsRouter } from "./runtime"

const settingsId = cuidv2d("runtime-settings-test", "state")
const runtimeId = cuidv2d("runtime-settings-test", "runtime")
const previousRevision = cuidv2d("runtime-settings-test", "previous")
const currentRevision = cuidv2d("runtime-settings-test", "current")
const nextRevision = cuidv2d("runtime-settings-test", "next")
const latestRevision = cuidv2d("runtime-settings-test", "latest")

function fixture() {
  const record = {
    id: settingsId,
    systemName: null,
    meta: { title: "State" },
    revision: currentRevision,
    createdAt: new Date(0),
    updatedAt: new Date(1),
    spec: { url: "s3://state", credentialsConfigured: true, encryptedCredentials: "ciphertext" },
  }

  const put = vi.fn(async () => record)
  const events = new EventEmitter()
  const remove = vi.fn(async () => {})
  const preflight = vi.fn(async () => [{ name: "engine", ok: false, detail: "Unavailable" }])

  const list = vi.fn(async (_context: unknown, kind: string) =>
    kind === "pulumi-state-backend" ? [record] : [],
  )

  const context = expect.objectContaining({
    realm: "backend",
    subject: expect.objectContaining({ type: "user" }),
  })

  const caller = runtimeSettingsRouter.createCaller({
    database: { backend: { user: { upsert: vi.fn(async () => ({})) } } },
    runtimeSettingsService: { put, delete: remove, preflight, list },
    pubsubManager: {
      subscribe: vi.fn(async (_key: unknown, signal: AbortSignal) =>
        (async function* () {
          try {
            for await (const change of on(events, "change", { signal })) {
              yield change
            }
          } catch (error) {
            if (!signal.aborted) {
              throw error
            }
          }
        })(),
      ),
    },
  } as never)

  return { caller, put, remove, preflight, context, events, record }
}

describe("Designer runtime settings transport", () => {
  it("streams a redacted initial snapshot and subsequent external changes", async () => {
    const { caller, events, record } = fixture()
    const stream = await caller.watch()
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    assert(first.value)
    expect(first.value.stateBackends[0]).toMatchObject({
      id: settingsId,
      revision: currentRevision,
    })
    expect(first.value.stateBackends[0].spec).not.toHaveProperty("encryptedCredentials")
    record.revision = nextRevision
    events.emit("change", {})
    const second = await iterator.next()
    assert(second.value)
    expect(second.value.stateBackends[0].revision).toBe(nextRevision)
    await iterator.return?.()
    expect(events.listenerCount("change")).toBe(0)
    record.revision = latestRevision
    const reconnected = (await caller.watch())[Symbol.asyncIterator]()
    const current = await reconnected.next()
    assert(current.value)
    expect(current.value.stateBackends[0].revision).toBe(latestRevision)
    await reconnected.return?.()
  })

  it("forwards expected revisions and secret preservation/clearing, and redacts outputs", async () => {
    const { caller, put, context } = fixture()
    const value = {
      meta: { title: "State" },
      revision: previousRevision,
      spec: { url: "s3://state" },
    }
    const result = await caller.put({ kind: "pulumi-state-backend", id: settingsId, value })
    expect(put).toHaveBeenCalledWith(context, "pulumi-state-backend", settingsId, value)
    expect(result).toMatchObject({
      revision: currentRevision,
      spec: { credentialsConfigured: true },
    })
    expect("spec" in result && result.spec).not.toHaveProperty("encryptedCredentials")

    await caller.put({
      kind: "pulumi-state-backend",
      id: settingsId,
      value: { ...value, spec: { ...value.spec, credentials: null } },
    })

    expect(put).toHaveBeenLastCalledWith(
      context,
      "pulumi-state-backend",
      settingsId,
      expect.objectContaining({ spec: { url: "s3://state", credentials: null } }),
    )

    const list = await caller.list()
    expect(list.stateBackends[0]?.spec).toEqual({ url: "s3://state", credentialsConfigured: true })
  })

  it("exposes revision conflicts and in-use failures as actionable transport codes", async () => {
    const { caller, put, remove } = fixture()
    put.mockRejectedValueOnce(new RuntimeSettingsConflictError("pulumi-state-backend", settingsId))

    await expect(
      caller.put({
        kind: "pulumi-state-backend",
        id: settingsId,
        value: {
          meta: { title: "State" },
          revision: previousRevision,
          spec: { url: "s3://state" },
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })

    remove.mockRejectedValueOnce(new RuntimeSettingsInUseError("pulumi-state-backend", settingsId))

    await expect(
      caller.delete({ kind: "pulumi-state-backend", id: settingsId, revision: currentRevision }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })

    expect(remove).toHaveBeenCalledTimes(1)

    remove.mockRejectedValueOnce(
      new RuntimeSettingsConflictError("pulumi-state-backend", settingsId),
    )

    await expect(
      caller.delete({ kind: "pulumi-state-backend", id: settingsId, revision: previousRevision }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("rejects invalid revisions and remote runtimes before reaching the service", async () => {
    const { caller, put, remove } = fixture()

    await expect(
      caller.delete({ kind: "container-runtime", id: runtimeId, revision: "invalid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })

    await expect(
      caller.put({
        kind: "container-runtime",
        id: runtimeId,
        value: {
          meta: { title: "Remote" },
          spec: {
            type: "docker",
            local: false,
            engineEndpoint: "https://engine.example",
            runtimeApiUrl: "https://runtime.example",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })

    expect(put).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("returns failed preflight checks and forwards provider errors", async () => {
    const { caller, preflight, context } = fixture()

    await expect(caller.preflight({ id: runtimeId })).resolves.toEqual([
      { name: "engine", ok: false, detail: "Unavailable" },
    ])

    expect(preflight).toHaveBeenCalledWith(context, runtimeId, undefined)
    preflight.mockRejectedValueOnce(new Error("Adapter unavailable"))
    await expect(caller.preflight({ id: runtimeId })).rejects.toThrow("Adapter unavailable")
  })
})
