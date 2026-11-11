import type { ContainerRuntimeAdapter, RuntimeAdapterProvider } from "./contracts"
import { describe, expect, vi } from "vitest"
import { test } from "../test-utils/services"
import { type AgentCommand, AgentConnectionRegistry } from "./agent-registry"
import { RuntimeCoordinator } from "./coordinator"
import { RuntimeCredentialSigner } from "./credentials"

function adapterFixture() {
  const cleanup = vi.fn(async () => {})
  const place = vi.fn(async () => ({ id: "native", labels: {}, state: "running" as const }))

  const discover = vi.fn(
    async () => [] as { id: string; labels: Record<string, string>; state: "running" }[],
  )

  const adapter = { cleanup, place, discover } as unknown as ContainerRuntimeAdapter
  const adapters: RuntimeAdapterProvider = { get: async () => adapter }
  return { adapters, cleanup, place, discover }
}

describe("RuntimeCoordinator persisted ownership", () => {
  test("aborts a pending dispatch wait and rejects expired backend lease renewal", async ({
    database,
    project,
  }) => {
    let now = Date.now()
    const fixture = adapterFixture()

    const coordinator = new RuntimeCoordinator(
      database,
      fixture.adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32), () => now),
      new AgentConnectionRegistry(),
      "backend",
      1000,
      () => now,
    )

    const workload = await coordinator.createWorkload({
      projectId: project.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const action = await coordinator.createAction({
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const controller = new AbortController()
    const dispatch = coordinator.dispatch(action.id, {}, controller.signal)
    const failed = expect(dispatch).rejects.toThrow("Pending wait cancelled")
    controller.abort(new Error("Pending wait cancelled"))
    await failed

    expect(
      (await database.backend.runtimeAction.findUniqueOrThrow({ where: { id: action.id } })).status,
    ).toBe("cancelled")

    now += 300_001

    await expect(
      coordinator.renewBackendLease(workload.id, workload.leaseGeneration),
    ).rejects.toThrow("expired")
  })

  test("persists before placement and preserves failed cleanup for retry", async ({
    database,
    project,
  }) => {
    const fixture = adapterFixture()

    const coordinator = new RuntimeCoordinator(
      database,
      fixture.adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )

    const workload = await coordinator.createWorkload({
      projectId: project.id,
      kind: "terminal",
      ownerId: "terminal",
    })

    await expect(coordinator.deleteCleanedWorkload(workload.id)).rejects.toThrow(
      "before native cleanup",
    )

    fixture.place.mockImplementationOnce(async () => {
      expect(
        await database.backend.runtimeWorkload.findUnique({ where: { id: workload.id } }),
      ).toMatchObject({ status: "starting", projectId: project.id })

      return { id: "native", labels: {}, state: "running" }
    })

    await coordinator.place(workload.id, { image: "terminal" })
    fixture.cleanup.mockRejectedValueOnce(new Error("Engine unavailable"))
    await expect(coordinator.requestCleanup(workload.id)).rejects.toThrow("Engine unavailable")

    expect(
      await database.backend.runtimeWorkload.findUniqueOrThrow({ where: { id: workload.id } }),
    ).toMatchObject({
      desiredState: "deleted",
      cleanedUpAt: null,
      lastError: "Error: Engine unavailable",
    })

    await coordinator.cleanup(workload.id)

    expect(
      (await database.backend.runtimeWorkload.findUniqueOrThrow({ where: { id: workload.id } }))
        .cleanedUpAt,
    ).toBeInstanceOf(Date)

    expect(fixture.cleanup).toHaveBeenCalledTimes(2)
    await coordinator.deleteCleanedWorkload(workload.id)

    expect(
      await database.backend.runtimeWorkload.findUnique({ where: { id: workload.id } }),
    ).toBeNull()
  })

  test("cancels an action waiting for connection without dispatching it later", async ({
    database,
    project,
  }) => {
    const fixture = adapterFixture()
    const signer = new RuntimeCredentialSigner("backend", new Uint8Array(32))
    const registry = new AgentConnectionRegistry()

    const coordinator = new RuntimeCoordinator(
      database,
      fixture.adapters,
      signer,
      registry,
      "backend",
    )

    const workload = await coordinator.createWorkload({
      projectId: project.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const action = await coordinator.createAction({
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const dispatch = coordinator.dispatch(action.id, { command: "up" })
    const failed = expect(dispatch).rejects.toThrow(/cancel/i)
    await coordinator.cancelAction(action.id)
    await failed
    const sent: AgentCommand[] = []
    const auth = await coordinator.authorize(workload.id, ["connect", "heartbeat", "pulumi"])

    await coordinator.connect(
      auth.token,
      { ...auth.scope, minimumProtocolVersion: 1, maximumProtocolVersion: 1 },
      {
        send: async command => {
          sent.push(command)
        },
        close: () => {},
      },
    )

    expect(sent).toEqual([])

    expect(
      (await database.backend.runtimeAction.findUniqueOrThrow({ where: { id: action.id } })).status,
    ).toBe("cancelled")
  })

  test("fences old credentials and streams, routes concurrent results and per-action cancellation", async ({
    database,
    project,
  }) => {
    const fixture = adapterFixture()
    const signer = new RuntimeCredentialSigner("backend", new Uint8Array(32))
    const registry = new AgentConnectionRegistry()

    const coordinator = new RuntimeCoordinator(
      database,
      fixture.adapters,
      signer,
      registry,
      "backend",
    )

    const workload = await coordinator.createWorkload({
      projectId: project.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const auth = await coordinator.authorize(workload.id, ["connect", "heartbeat", "pulumi"])
    const sent: AgentCommand[] = []
    const close = vi.fn()

    const connection = await coordinator.connect(
      auth.token,
      { ...auth.scope, minimumProtocolVersion: 1, maximumProtocolVersion: 1 },
      {
        send: async command => {
          sent.push(command)
        },
        close,
      },
    )

    const first = await coordinator.createAction({
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "first",
    })

    const second = await coordinator.createAction({
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "second",
    })

    await Promise.all([coordinator.dispatch(first.id, {}), coordinator.dispatch(second.id, {})])
    await coordinator.cancelAction(first.id)
    await coordinator.cancelAction(first.id, true)

    expect(
      sent
        .filter(command => command.type === "cancel")
        .map(command => [command.actionId, command.force]),
    ).toEqual([
      [first.id, false],
      [first.id, true],
    ])

    expect(
      (await database.backend.runtimeAction.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe("running")

    await coordinator.receive(connection, {
      type: "completed",
      actionId: second.id,
      exitCode: 0,
      result: { ok: true },
    })

    await expect(coordinator.waitForAction(second.id)).resolves.toMatchObject({
      type: "completed",
      result: { ok: true },
    })

    await coordinator.authorize(workload.id, ["connect", "pulumi"])
    expect(close).toHaveBeenCalled()

    await expect(
      coordinator.receive(connection, { type: "completed", actionId: first.id, exitCode: 0 }),
    ).rejects.toThrow(/stale/i)

    await expect(
      coordinator.connect(
        auth.token,
        { ...auth.scope, minimumProtocolVersion: 1, maximumProtocolVersion: 1 },
        { send: async () => {}, close: () => {} },
      ),
    ).rejects.toThrow(/stale/i)

    expect(
      (await database.backend.runtimeAction.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe("interrupted")
  })

  test("recovers placement across a crash and interrupts actions without replay", async ({
    database,
    project,
  }) => {
    const fixture = adapterFixture()

    const coordinator = new RuntimeCoordinator(
      database,
      fixture.adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )

    const workload = await coordinator.createWorkload({
      projectId: project.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    const action = await coordinator.createAction({
      workloadId: workload.id,
      kind: "pulumi",
      ownerId: "operation",
    })

    await database.backend.runtimeAction.update({
      where: { id: action.id },
      data: { status: "running" },
    })

    fixture.discover.mockResolvedValue([
      {
        id: "orphan-placement",
        state: "running",
        labels: {
          "highstate.io/workload": workload.id,
          "highstate.io/generation": String(workload.leaseGeneration),
        },
      },
    ])

    await coordinator.reconcile(workload.runtimeId)

    expect(
      (await database.backend.runtimeWorkload.findUniqueOrThrow({ where: { id: workload.id } }))
        .nativeResourceId,
    ).toBe("orphan-placement")

    expect(
      (await database.backend.runtimeAction.findUniqueOrThrow({ where: { id: action.id } })).status,
    ).toBe("interrupted")

    expect(fixture.place).not.toHaveBeenCalled()
  })
})
