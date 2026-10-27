import type { ContainerRuntimeAdapter, ImageBuildRequest, ImageIdentity } from "./contracts"
import { randomUUID } from "node:crypto"
import { describe, expect, vi } from "vitest"
import { type LibrarySnapshotContent, snapshotHash } from "../library"
import { test } from "../test-utils/services"
import { AgentConnectionRegistry } from "./agent-registry"
import { RuntimeCoordinator } from "./coordinator"
import { RuntimeCredentialSigner } from "./credentials"
import { SnapshotImageManager } from "./snapshot-images"

function snapshotFixture() {
  const content: LibrarySnapshotContent = {
    packages: [],
    selectedPackages: [],
    lockfile: '{"workspaces":{"":{}}}',
    model: { components: {}, entities: {} },
    sourceManifest: { packages: {}, owners: {} },
    compatibility: {
      runtimeProtocolVersion: 1,
      packageFormatVersion: 1,
      bunVersion: "1.3.13",
      pulumiVersion: "3.232.0",
    },
  }
  return { ...content, id: randomUUID(), hash: snapshotHash(content) }
}

describe("Snapshot image materialization", () => {
  test("keeps failed builds diagnostic and retries only when explicitly requested", async ({
    database,
    project,
  }) => {
    const snapshot = snapshotFixture()
    const buildImage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Frozen installation failed"))
      .mockResolvedValue({
        reference: "sha256:retry",
        digest: "sha256:retry",
        imageHash: snapshot.hash,
      })
    const adapter = {
      capabilities: { build: true },
      buildImage,
      verifyImage: async () => true,
      cleanup: async () => {},
    } as unknown as ContainerRuntimeAdapter
    const adapters = { get: async () => adapter }
    const coordinator = new RuntimeCoordinator(
      database,
      adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )
    const manager = new SnapshotImageManager(
      database,
      adapters,
      coordinator,
      { get: async () => ({ baseImage: `runner@sha256:${"a".repeat(64)}` }) },
      { snapshot: async () => snapshot, desiredSnapshotId: async () => snapshot.id },
    )
    await expect(manager.ensureImage(project.id, snapshot.id)).rejects.toThrow(
      "Frozen installation failed",
    )
    expect(await manager.getImageStatus(project.id, snapshot.id)).toMatchObject({
      status: "failed",
      generation: 1,
      error: "Error: Frozen installation failed",
    })
    await expect(manager.ensureImage(project.id, snapshot.id)).rejects.toThrow(
      "Frozen installation failed",
    )
    expect(buildImage).toHaveBeenCalledTimes(1)
    await expect(manager.retryDesiredImage(project.id)).resolves.toMatchObject({
      reference: "sha256:retry",
      generation: 2,
    })
    expect(buildImage).toHaveBeenCalledTimes(2)
  })
  test("persists phases and builds from the frozen durable graph without creating an agent action", async ({
    database,
    project,
  }) => {
    const snapshot = snapshotFixture()
    const builds: ImageBuildRequest[] = []
    const cleanup = vi.fn(async () => {})
    const adapter = {
      capabilities: { build: true },
      verifyImage: async () => true,
      cleanup,
      buildImage: async (
        request: ImageBuildRequest,
        progress: (phase: "installing" | "building" | "verifying") => Promise<void>,
      ) => {
        builds.push(request)
        expect(
          await database.backend.runtimeWorkload.findUniqueOrThrow({
            where: { id: request.owner.workloadId },
          }),
        ).toMatchObject({ kind: "library_build", status: "starting" })
        for (const phase of ["installing", "building", "verifying"] as const) {
          await progress(phase)
          expect(
            (
              await database.backend.librarySnapshotImage.findFirstOrThrow({
                where: { snapshotId: snapshot.id },
              })
            ).status,
          ).toBe(phase)
        }
        return { reference: "sha256:local", digest: "sha256:local", imageHash: snapshot.hash }
      },
    } as unknown as ContainerRuntimeAdapter
    const adapters = { get: async () => adapter }
    const coordinator = new RuntimeCoordinator(
      database,
      adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )
    const manager = new SnapshotImageManager(
      database,
      adapters,
      coordinator,
      {
        get: async () => ({
          baseImage: `runner@sha256:${"a".repeat(64)}`,
          npmrc: Buffer.from("secret"),
        }),
      },
      { snapshot: async () => snapshot, desiredSnapshotId: async () => snapshot.id },
    )
    const result = await manager.ensureImage(project.id, snapshot.id)
    expect(result.snapshotHash).toBe(snapshot.hash)
    expect(
      Buffer.from(builds[0]!.files.find(file => file.path === "bun.lock")!.data).toString(),
    ).toBe(snapshot.lockfile)
    expect(
      builds[0]!.files.some(file => Buffer.from(file.data).toString().includes("secret")),
    ).toBe(false)
    expect(Buffer.from(builds[0]!.secrets![0]!.data).toString()).toBe("secret")
    expect(
      await database.backend.runtimeAction.count({ where: { workloadId: result.workloadId! } }),
    ).toBe(0)
    expect((await manager.getImageStatus(project.id, snapshot.id))?.status).toBe("ready")
    await manager.ensureImage(project.id, snapshot.id)
    expect(builds).toHaveLength(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
    await coordinator.deleteCleanedWorkload(result.workloadId!)
    await expect(manager.ensureImage(project.id, snapshot.id)).resolves.toMatchObject({
      workloadId: null,
      reference: result.reference,
    })
    expect(builds).toHaveLength(1)
  })

  test("rejects stale build results after retry replaces the current workload and generation", async ({
    database,
    project,
  }) => {
    const snapshot = snapshotFixture()
    let firstStarted: () => void = () => {}
    const started = new Promise<void>(resolve => {
      firstStarted = resolve
    })
    let finishFirst: (image: ImageIdentity) => void = () => {}
    let count = 0
    const buildImage = vi.fn(async () => {
      count++
      if (count === 1) {
        firstStarted()
        return await new Promise<ImageIdentity>(resolve => {
          finishFirst = resolve
        })
      }
      return { reference: "sha256:new", digest: "sha256:new", imageHash: snapshot.hash }
    })
    const adapter = {
      capabilities: { build: true },
      buildImage,
      verifyImage: async () => true,
      cleanup: async () => {},
    } as unknown as ContainerRuntimeAdapter
    const adapters = { get: async () => adapter }
    const coordinator = new RuntimeCoordinator(
      database,
      adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )
    const manager = new SnapshotImageManager(
      database,
      adapters,
      coordinator,
      { get: async () => ({ baseImage: `runner@sha256:${"a".repeat(64)}` }) },
      { snapshot: async () => snapshot, desiredSnapshotId: async () => snapshot.id },
    )
    const first = manager.ensureImage(project.id, snapshot.id)
    const rejected = expect(first).rejects.toThrow(/superseded/)
    await started
    const second = await manager.retryDesiredImage(project.id)
    finishFirst({ reference: "sha256:old", digest: "sha256:old", imageHash: snapshot.hash })
    await rejected
    const cache = await manager.getImageStatus(project.id, snapshot.id)
    expect(cache).toMatchObject({
      status: "ready",
      generation: 2,
      imageRef: "sha256:new",
      workloadId: second.workloadId,
      error: null,
    })
    const oldWorkloads = await database.backend.runtimeWorkload.findMany({
      where: { ownerId: snapshot.id },
    })
    expect(oldWorkloads).toHaveLength(2)
    expect(oldWorkloads.every(workload => workload.cleanedUpAt !== null)).toBe(true)
  })

  test("aborts a waiting operation without cancelling the shared image build", async ({
    database,
    project,
  }) => {
    const snapshot = snapshotFixture()
    let started: () => void = () => {}
    const building = new Promise<void>(resolve => {
      started = resolve
    })
    let finish: (value: ImageIdentity) => void = () => {}
    const buildImage = vi.fn(async () => {
      started()
      return await new Promise<ImageIdentity>(resolve => {
        finish = resolve
      })
    })
    const adapter = {
      capabilities: { build: true },
      buildImage,
      verifyImage: async () => true,
      cleanup: async () => {},
    } as unknown as ContainerRuntimeAdapter
    const adapters = { get: async () => adapter }
    const coordinator = new RuntimeCoordinator(
      database,
      adapters,
      new RuntimeCredentialSigner("backend", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "backend",
    )
    const manager = new SnapshotImageManager(
      database,
      adapters,
      coordinator,
      { get: async () => ({ baseImage: `runner@sha256:${"a".repeat(64)}` }) },
      { snapshot: async () => snapshot, desiredSnapshotId: async () => snapshot.id },
    )
    const cancellation = new AbortController()
    const first = manager.ensureImage(project.id, snapshot.id, cancellation.signal)
    const rejected = expect(first).rejects.toThrow("Operation cancelled")
    await building
    cancellation.abort(new Error("Operation cancelled"))
    await rejected
    const second = manager.ensureImage(project.id, snapshot.id)
    finish({ reference: "sha256:ready", digest: "sha256:ready", imageHash: snapshot.hash })
    await expect(second).resolves.toMatchObject({ reference: "sha256:ready" })
    expect(buildImage).toHaveBeenCalledTimes(1)
  })
})
