import type { DatabaseManager, LibrarySnapshotImage } from "../database"
import type {
  ImageIdentity,
  RegistryCredential,
  RuntimeAdapterProvider,
  RuntimeFile,
} from "./contracts"
import type { RuntimeCoordinator } from "./coordinator"
import {
  getFrozenSnapshotPackageJson,
  PrismaProjectLibraryStore,
  type ProjectLibrarySnapshot,
  snapshotHash,
} from "../library"
import { abortable, delay } from "./contracts"

export type SnapshotImage = ImageIdentity & {
  projectId: string
  snapshotId: string
  snapshotHash: string
  runtimeId: string
  workloadId: string | null
  generation: number
}
export type SnapshotImageBuildConfig = {
  /**
   * The release-aligned runner base, pinned by digest.
   */
  baseImage: string
  repository?: string
  platforms?: string[]
  npmrc?: Uint8Array
  registryCredentials?: RegistryCredential[]
}
export interface SnapshotImageConfiguration {
  get(projectId: string, runtimeId: string): Promise<SnapshotImageBuildConfig>
}
export interface SnapshotImageSource {
  snapshot(projectId: string, snapshotId: string): Promise<ProjectLibrarySnapshot>
  desiredSnapshotId(projectId: string): Promise<string | null>
}
export interface SnapshotImageService {
  ensureImage(projectId: string, snapshotId: string, signal?: AbortSignal): Promise<SnapshotImage>
  retryDesiredImage(projectId: string, signal?: AbortSignal): Promise<SnapshotImage>
  getImageStatus(projectId: string, snapshotId: string): Promise<LibrarySnapshotImage | null>
  ensureDesiredImage(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
    retry?: boolean,
  ): Promise<SnapshotImage>
  getDesiredImage(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
  ): Promise<LibrarySnapshotImage | null>
}

export class DatabaseSnapshotImageSource implements SnapshotImageSource {
  constructor(private readonly database: DatabaseManager) {}

  async snapshot(projectId: string, snapshotId: string): Promise<ProjectLibrarySnapshot> {
    return await new PrismaProjectLibraryStore(this.database).snapshot(projectId, snapshotId)
  }

  async desiredSnapshotId(projectId: string): Promise<string | null> {
    const project = await this.database.forProject(projectId)
    return (await project.projectLibraryState.findUniqueOrThrow({ where: { id: "default" } }))
      .desiredSnapshotId
  }
}

/**
 * Rebuilds disposable backend image caches from durable project snapshots.
 */
export class SnapshotImageManager implements SnapshotImageService {
  private readonly builds = new Map<string, Promise<SnapshotImage>>()

  constructor(
    private readonly database: DatabaseManager,
    private readonly adapters: RuntimeAdapterProvider,
    private readonly coordinator: RuntimeCoordinator,
    private readonly configuration: SnapshotImageConfiguration,
    private readonly source: SnapshotImageSource = new DatabaseSnapshotImageSource(database),
  ) {}

  async ensureDesiredImage(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
    retry = false,
  ): Promise<SnapshotImage> {
    if ((await this.source.desiredSnapshotId(projectId)) !== snapshot.id) {
      throw new Error("Desired library snapshot changed")
    }

    const image = retry
      ? await this.retryDesiredImage(projectId)
      : await this.ensureImage(projectId, snapshot.id)

    if ((await this.source.desiredSnapshotId(projectId)) !== snapshot.id) {
      throw new Error("Desired library snapshot changed")
    }

    return image
  }

  async getDesiredImage(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
  ): Promise<LibrarySnapshotImage | null> {
    return await this.getImageStatus(projectId, snapshot.id)
  }

  async getImageStatus(
    projectId: string,
    snapshotId: string,
  ): Promise<LibrarySnapshotImage | null> {
    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
    })

    return await this.database.backend.librarySnapshotImage.findUnique({
      where: {
        projectId_snapshotId_runtimeId: {
          projectId,
          snapshotId,
          runtimeId: project.containerRuntimeId,
        },
      },
    })
  }

  async ensureImage(
    projectId: string,
    snapshotId: string,
    signal?: AbortSignal,
  ): Promise<SnapshotImage> {
    signal?.throwIfAborted()

    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
    })

    const key = `${projectId}/${snapshotId}/${project.containerRuntimeId}`
    let pending = this.builds.get(key)
    if (!pending) {
      pending = this.materialize(projectId, snapshotId, project.containerRuntimeId, false)
      this.builds.set(key, pending)

      void pending
        .finally(() => {
          if (this.builds.get(key) === pending) {
            this.builds.delete(key)
          }
        })
        .catch(() => {})
    }

    // cancelling one operation's barrier must not cancel a shared snapshot build
    const image = await abortable(pending, signal)
    if (
      (await this.database.backend.project.findUniqueOrThrow({ where: { id: projectId } }))
        .containerRuntimeId !== image.runtimeId
    ) {
      throw new Error("Project runtime changed while waiting for its image")
    }

    return image
  }

  async retryDesiredImage(projectId: string, signal?: AbortSignal): Promise<SnapshotImage> {
    signal?.throwIfAborted()
    const snapshotId = await this.source.desiredSnapshotId(projectId)
    if (!snapshotId) {
      throw new Error("Project has no desired library snapshot")
    }

    const project = await this.database.backend.project.findUniqueOrThrow({
      where: { id: projectId },
    })

    const key = `${projectId}/${snapshotId}/${project.containerRuntimeId}`
    const build = this.materialize(projectId, snapshotId, project.containerRuntimeId, true)
    this.builds.set(key, build)

    void build
      .finally(() => {
        if (this.builds.get(key) === build) {
          this.builds.delete(key)
        }
      })
      .catch(() => {})

    const image = await abortable(build, signal)

    if ((await this.source.desiredSnapshotId(projectId)) !== snapshotId) {
      throw new Error("Desired library snapshot changed")
    }

    if (
      (await this.database.backend.project.findUniqueOrThrow({ where: { id: projectId } }))
        .containerRuntimeId !== image.runtimeId
    ) {
      throw new Error("Project runtime changed while waiting for its image")
    }

    return image
  }

  private dto(image: LibrarySnapshotImage): SnapshotImage {
    if (!image.imageRef || !image.imageDigest || !image.imageHash) {
      throw new Error("Image cache has incomplete immutable identity")
    }

    return {
      projectId: image.projectId,
      snapshotId: image.snapshotId,
      snapshotHash: image.snapshotHash,
      runtimeId: image.runtimeId,
      workloadId: image.workloadId,
      generation: image.generation,
      reference: image.imageRef,
      digest: image.imageDigest,
      imageHash: image.imageHash,
    }
  }

  private async materialize(
    projectId: string,
    snapshotId: string,
    runtimeId: string,
    retry: boolean,
  ): Promise<SnapshotImage> {
    const snapshot = await this.source.snapshot(projectId, snapshotId)
    const { id: _id, hash, ...content } = snapshot

    if (snapshotHash(content) !== hash) {
      throw new Error("Library snapshot hash mismatch")
    }

    if (
      snapshot.compatibility.runtimeProtocolVersion !== 1 ||
      snapshot.compatibility.packageFormatVersion !== 1
    ) {
      throw new Error("Unsupported snapshot runtime or package format version")
    }

    const adapter = await this.adapters.get(runtimeId)
    if (!adapter.capabilities.build) {
      throw new Error("Selected runtime cannot build snapshot images")
    }

    const unique = { projectId, snapshotId, runtimeId }

    let cached = await this.database.backend.librarySnapshotImage.findUnique({
      where: { projectId_snapshotId_runtimeId: unique },
    })

    if (cached && cached.snapshotHash !== snapshot.hash) {
      throw new Error("Image cache snapshot hash mismatch")
    }

    if (cached?.status === "ready" && !retry && (await adapter.verifyImage(this.dto(cached)))) {
      return this.dto(cached)
    }

    if (cached?.status === "failed" && !retry) {
      throw new Error(cached.error ?? "Snapshot image build failed")
    }

    if (cached?.workloadId && !retry && !["ready", "failed"].includes(cached.status)) {
      const workload = await this.database.backend.runtimeWorkload.findUnique({
        where: { id: cached.workloadId },
      })

      if (
        workload &&
        !["failed", "lost", "completed", "cancelled"].includes(workload.status) &&
        workload.leaseExpiresAt &&
        workload.leaseExpiresAt.getTime() > Date.now()
      ) {
        // another caller owns the current build; observe it rather than silently starting a duplicate
        for (;;) {
          await delay(200)

          const current = await this.database.backend.librarySnapshotImage.findUniqueOrThrow({
            where: { id: cached.id },
          })

          if (current.generation !== cached.generation) {
            throw new Error("Snapshot image build superseded")
          }

          if (current.status === "ready") {
            return this.dto(current)
          }

          if (current.status === "failed") {
            throw new Error(current.error ?? "Snapshot image build failed")
          }

          const owner = await this.database.backend.runtimeWorkload.findUniqueOrThrow({
            where: { id: current.workloadId! },
          })

          if (!owner.leaseExpiresAt || owner.leaseExpiresAt.getTime() <= Date.now()) {
            break
          }
        }
      }
    }

    const config = await this.configuration.get(projectId, runtimeId)

    const workload = await this.coordinator.createWorkload({
      projectId,
      kind: "library_build",
      ownerId: snapshotId,
    })

    if (workload.runtimeId !== runtimeId) {
      await this.coordinator.requestCleanup(workload.id)
      throw new Error("Project runtime changed before image build")
    }

    try {
      cached = await this.database.backend.$transaction(async tx => {
        const existing = await tx.librarySnapshotImage.findUnique({
          where: { projectId_snapshotId_runtimeId: unique },
        })

        if (!existing) {
          return await tx.librarySnapshotImage.create({
            data: { ...unique, snapshotHash: snapshot.hash, workloadId: workload.id },
          })
        }

        const updated = await tx.librarySnapshotImage.updateMany({
          where: { id: existing.id, generation: cached?.generation ?? existing.generation },
          data: {
            generation: { increment: 1 },
            workloadId: workload.id,
            status: "queued",
            error: null,
            completedAt: null,
            imageRef: null,
            imageDigest: null,
            imageHash: null,
          },
        })

        if (!updated.count) {
          throw new Error("Snapshot image build generation changed concurrently")
        }

        return await tx.librarySnapshotImage.findUniqueOrThrow({ where: { id: existing.id } })
      })
    } catch (error) {
      await this.coordinator.requestCleanup(workload.id)
      throw error
    }

    const fence = { id: cached.id, workloadId: workload.id, generation: cached.generation }

    // build workload leases are renewed by the backend adapter, never by an agent action
    const renew = setInterval(() => {
      void this.database.backend.runtimeWorkload
        .updateMany({
          where: { id: workload.id, desiredState: "running" },
          data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
        })
        .catch(() => {})
    }, 10_000)

    try {
      await this.database.backend.runtimeWorkload.update({
        where: { id: workload.id },
        data: { status: "starting" },
      })

      const files: RuntimeFile[] = [
        {
          path: "package.json",
          data: Buffer.from(JSON.stringify(getFrozenSnapshotPackageJson(snapshot))),
        },
        { path: "bun.lock", data: Buffer.from(snapshot.lockfile) },
        { path: "highstate-model.json", data: Buffer.from(JSON.stringify(snapshot.model)) },
        {
          path: "highstate-sources.json",
          data: Buffer.from(JSON.stringify(snapshot.sourceManifest)),
        },
        {
          path: "highstate-compatibility.json",
          data: Buffer.from(JSON.stringify(snapshot.compatibility)),
        },
      ]

      const image = await adapter.buildImage(
        {
          owner: this.coordinator.ownership(workload),
          snapshotId,
          snapshotHash: snapshot.hash,
          buildGeneration: cached.generation,
          baseImage: config.baseImage,
          repository: config.repository,
          platforms: config.platforms,
          files,
          secrets: config.npmrc ? [{ path: "npmrc", data: config.npmrc, secret: true }] : [],
          registryCredentials: config.registryCredentials,
        },
        async phase => {
          const update = await this.database.backend.librarySnapshotImage.updateMany({
            where: fence,
            data: { status: phase, progress: { message: phase } },
          })

          if (!update.count) {
            throw new Error("Snapshot image build superseded")
          }
        },
      )

      if (image.imageHash !== snapshot.hash || !(await adapter.verifyImage(image))) {
        throw new Error("Snapshot image verification failed")
      }

      const updated = await this.database.backend.librarySnapshotImage.updateMany({
        where: fence,
        data: {
          status: "ready",
          imageRef: image.reference,
          imageDigest: image.digest,
          imageHash: image.imageHash,
          completedAt: new Date(),
        },
      })

      if (!updated.count) {
        throw new Error("Snapshot image build superseded")
      }

      await this.database.backend.runtimeWorkload.update({
        where: { id: workload.id },
        data: { status: "completed", finishedAt: new Date() },
      })

      return this.dto(
        await this.database.backend.librarySnapshotImage.findUniqueOrThrow({
          where: { id: cached.id },
        }),
      )
    } catch (error) {
      await this.database.backend.librarySnapshotImage.updateMany({
        where: fence,
        data: { status: "failed", error: String(error), completedAt: new Date() },
      })

      await this.database.backend.runtimeWorkload.update({
        where: { id: workload.id },
        data: { status: "failed", lastError: String(error), finishedAt: new Date() },
      })

      throw error
    } finally {
      clearInterval(renew)
      // failure is retained on the workload and retried by reconciliation; never detach its owner first
      await this.coordinator.requestCleanup(workload.id).catch(() => {})
    }
  }
}
