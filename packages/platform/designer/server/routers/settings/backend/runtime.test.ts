import { RuntimeSettingsConflictError, RuntimeSettingsInUseError } from "@highstate/backend/shared"
import { describe, expect, it, vi } from "vitest"
import { runtimeSettingsRouter } from "./runtime"

function fixture() {
  const record = {
    id: "state",
    meta: { title: "State" },
    revision: 3,
    createdAt: new Date(0),
    updatedAt: new Date(1),
    spec: { url: "s3://state", credentialsConfigured: true, encryptedCredentials: "ciphertext" },
  }
  const put = vi.fn(async () => record)
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
  } as never)
  return { caller, put, remove, preflight, context }
}

describe("Designer runtime settings transport", () => {
  it("forwards expected revisions and secret preservation/clearing, and redacts outputs", async () => {
    const { caller, put, context } = fixture()
    const value = { meta: { title: "State" }, revision: 2, spec: { url: "s3://state" } }
    const result = await caller.put({ kind: "pulumi-state-backend", id: "state", value })
    expect(put).toHaveBeenCalledWith(context, "pulumi-state-backend", "state", value)
    expect(result).toMatchObject({ revision: 3, spec: { credentialsConfigured: true } })
    expect("spec" in result && result.spec).not.toHaveProperty("encryptedCredentials")
    await caller.put({
      kind: "pulumi-state-backend",
      id: "state",
      value: { ...value, spec: { ...value.spec, credentials: null } },
    })
    expect(put).toHaveBeenLastCalledWith(
      context,
      "pulumi-state-backend",
      "state",
      expect.objectContaining({ spec: { url: "s3://state", credentials: null } }),
    )
    const list = await caller.list()
    expect(list.stateBackends[0]?.spec).toEqual({ url: "s3://state", credentialsConfigured: true })
  })

  it("exposes revision conflicts and in-use failures as actionable transport codes", async () => {
    const { caller, put, remove } = fixture()
    put.mockRejectedValueOnce(new RuntimeSettingsConflictError("pulumi-state-backend", "state"))
    await expect(
      caller.put({
        kind: "pulumi-state-backend",
        id: "state",
        value: { meta: { title: "State" }, revision: 2, spec: { url: "s3://state" } },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    remove.mockRejectedValueOnce(new RuntimeSettingsInUseError("pulumi-state-backend", "state"))
    await expect(
      caller.delete({ kind: "pulumi-state-backend", id: "state", revision: 3 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    expect(remove).toHaveBeenCalledTimes(1)
    remove.mockRejectedValueOnce(new RuntimeSettingsConflictError("pulumi-state-backend", "state"))
    await expect(
      caller.delete({ kind: "pulumi-state-backend", id: "state", revision: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("rejects invalid revisions and remote runtimes before reaching the service", async () => {
    const { caller, put, remove } = fixture()
    await expect(
      caller.delete({ kind: "container-runtime", id: "runtime", revision: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    await expect(
      caller.put({
        kind: "container-runtime",
        id: "runtime",
        value: {
          revision: 0,
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
    await expect(caller.preflight({ id: "runtime" })).resolves.toEqual([
      { name: "engine", ok: false, detail: "Unavailable" },
    ])
    expect(preflight).toHaveBeenCalledWith(context, "runtime", undefined)
    preflight.mockRejectedValueOnce(new Error("Adapter unavailable"))
    await expect(caller.preflight({ id: "runtime" })).rejects.toThrow("Adapter unavailable")
  })
})
