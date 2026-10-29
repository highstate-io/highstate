import type { DatabaseManager } from "../database"
import type { ContainerRuntimeAdapter, WorkloadIntent } from "./contracts"
import { randomUUID } from "node:crypto"
import { describe, expect, vi } from "vitest"
import { test } from "../test-utils/services"
import { AgentConnectionRegistry } from "./agent-registry"
import { RuntimeCoordinator } from "./coordinator"
import { RuntimeCredentialSigner } from "./credentials"
import { RuntimeWorkloadProbe } from "./probe"

function fixture(database: DatabaseManager, timeoutMs = 5000) {
  const signer = new RuntimeCredentialSigner("backend", new Uint8Array(32))
  const close = vi.fn()
  const cleanup = vi.fn(async () => {})

  const place = vi.fn(async (intent: WorkloadIntent) => {
    const env = intent.env!

    await coordinator.connect(
      env.HIGHSTATE_AGENT_TOKEN!,
      {
        ...JSON.parse(env.HIGHSTATE_AGENT_SCOPE!),
        minimumProtocolVersion: 1,
        maximumProtocolVersion: 1,
      },
      { send: async () => {}, close },
    )

    return { id: randomUUID(), labels: {}, state: "running" as const }
  })

  const adapter = { place, cleanup } as unknown as ContainerRuntimeAdapter

  const coordinator = new RuntimeCoordinator(
    database,
    { get: async () => adapter },
    signer,
    new AgentConnectionRegistry(),
    "backend",
  )

  const options = {
    image: "runner:probe",
    agent: { binary: "bun", path: "/agent/main.js" },
    timeoutMs,
  }

  const probe = new RuntimeWorkloadProbe(database, coordinator, options)
  return { probe, coordinator, signer, place, cleanup, close, options }
}

describe("RuntimeWorkloadProbe", () => {
  test("requires real scoped authentication and cleans up each uniquely owned probe", async ({
    database,
    project,
  }) => {
    const runtimeId = project.containerRuntimeId!

    const runtime = await database.backend.containerRuntime.findUniqueOrThrow({
      where: { id: runtimeId },
    })

    await database.backend.containerRuntime.update({
      where: { id: runtimeId },
      data: {
        spec: {
          ...runtime.spec,
          runtimeApiUrl: "https://runtime.example:7284",
          runtimeApiCaBundle: "probe-ca",
        },
      },
    })

    const f = fixture(database)
    const authenticate = vi.spyOn(f.coordinator, "authenticate")
    await f.probe.probe(runtimeId)
    await f.probe.probe(runtimeId)
    expect(authenticate).toHaveBeenCalledTimes(2)
    const intents = f.place.mock.calls.map(([intent]) => intent)
    expect(new Set(intents.map(intent => intent.owner.workloadId)).size).toBe(2)

    for (const intent of intents) {
      expect(intent).toMatchObject({
        image: "runner:probe",
        command: ["bun", "/agent/main.js"],
        owner: { runtimeId, projectId: project.id, kind: "composite_evaluation" },
        env: {
          HIGHSTATE_AGENT_URL: "https://runtime.example:7284",
          HIGHSTATE_AGENT_CA: "probe-ca",
        },
      })

      const credential = f.signer.verify(intent.env!.HIGHSTATE_AGENT_TOKEN!)

      expect(credential).toMatchObject({
        ...JSON.parse(intent.env!.HIGHSTATE_AGENT_SCOPE!),
        permissions: ["connect", "heartbeat", "evaluation"],
      })

      expect(f.coordinator.connections.current(intent.owner.workloadId)).toBeUndefined()

      expect(
        await database.backend.runtimeWorkload.findUniqueOrThrow({
          where: { id: intent.owner.workloadId },
        }),
      ).toMatchObject({
        desiredState: "deleted",
        cleanedUpAt: expect.any(Date),
        ownerId: expect.stringMatching(/^runtime-probe:/),
      })
    }

    expect(f.cleanup).toHaveBeenCalledTimes(2)
    expect(f.close).toHaveBeenCalledTimes(2)
  })

  test("fails actionably without a configured base image or assigned project", async ({
    database,
    project,
  }) => {
    const f = fixture(database)

    const missingImage = new RuntimeWorkloadProbe(database, f.coordinator, {
      agent: f.options.agent,
    })

    await expect(missingImage.probe(project.containerRuntimeId!)).rejects.toThrow(
      "Configure a runtime base image",
    )

    const runtime = await database.backend.containerRuntime.create({
      data: {
        meta: { title: "Unassigned" },
        spec: {
          type: "docker",
          local: true,
          engineEndpoint: "unix:///var/run/docker.sock",
          runtimeApiUrl: "https://runtime.example",
        },
      },
    })

    await expect(f.probe.probe(runtime.id)).rejects.toThrow("Assign an existing project")
    expect(f.place).not.toHaveBeenCalled()
    expect(f.cleanup).not.toHaveBeenCalled()
  })

  test("times out an unconnected agent and cleans up instead of accepting native running state", async ({
    database,
    project,
  }) => {
    const f = fixture(database, 100)
    f.place.mockImplementation(async () => ({ id: randomUUID(), labels: {}, state: "running" }))
    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow("timed out")
    expect(f.cleanup).toHaveBeenCalledTimes(1)

    expect(
      f.coordinator.connections.current(f.place.mock.calls[0]![0].owner.workloadId),
    ).toBeUndefined()
  })

  test("cancels a connection wait but does not cancel cleanup", async ({ database, project }) => {
    const f = fixture(database)
    const controller = new AbortController()

    f.place.mockImplementation(async () => {
      controller.abort(new Error("Probe cancelled"))
      return { id: randomUUID(), labels: {}, state: "running" }
    })

    await expect(f.probe.probe(project.containerRuntimeId!, controller.signal)).rejects.toThrow(
      "Probe cancelled",
    )

    expect(f.cleanup).toHaveBeenCalledTimes(1)
  })

  test("cleans up when authorization or placement fails", async ({ database, project }) => {
    const f = fixture(database)
    vi.spyOn(f.coordinator, "authorize").mockRejectedValueOnce(new Error("Credential failure"))
    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow("Credential failure")
    f.place.mockRejectedValueOnce(new Error("Image missing"))
    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow("Image missing")
    expect(f.cleanup).toHaveBeenCalledTimes(2)
  })

  test("rejects a project assignment race before placing on a different runtime", async ({
    database,
    project,
  }) => {
    const f = fixture(database)
    const create = f.coordinator.createWorkload.bind(f.coordinator)

    vi.spyOn(f.coordinator, "createWorkload").mockImplementationOnce(async input => ({
      ...(await create(input)),
      runtimeId: "other-runtime",
    }))

    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow(
      "Project runtime changed",
    )

    expect(f.place).not.toHaveBeenCalled()
    expect(f.cleanup).toHaveBeenCalledTimes(1)
  })

  test("fails if an observed connection cannot authenticate", async ({ database, project }) => {
    const f = fixture(database)
    vi.spyOn(f.coordinator, "authenticate").mockRejectedValueOnce(new Error("Stale runtime stream"))
    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow("Stale runtime stream")
    expect(f.cleanup).toHaveBeenCalledTimes(1)
  })

  test("reports cleanup failure after successful authentication and retains both failures otherwise", async ({
    database,
    project,
  }) => {
    const f = fixture(database)
    f.cleanup.mockRejectedValue(new Error("Engine unavailable"))

    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toThrow(
      "Failed to clean up runtime probe",
    )

    f.place.mockRejectedValueOnce(new Error("Image missing"))

    await expect(f.probe.probe(project.containerRuntimeId!)).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "Image missing" }),
        expect.objectContaining({
          cause: expect.objectContaining({ message: "Engine unavailable" }),
        }),
      ],
    })
  })

  test("honors cancellation before creating resources", async ({ database, project }) => {
    const f = fixture(database)

    await expect(
      f.probe.probe(project.containerRuntimeId!, AbortSignal.abort(new Error("Already cancelled"))),
    ).rejects.toThrow("Already cancelled")

    expect(f.place).not.toHaveBeenCalled()
    expect(f.cleanup).not.toHaveBeenCalled()
  })
})
