import type { CommonObjectMeta } from "@highstate/contract"
import type { Logger } from "pino"
import type { ArtifactBackend } from "../artifact"
import type { Artifact, DatabaseManager, ProjectTransaction } from "../database"
import { createId } from "@paralleldrive/cuid2"

export const artifactChunkSize = 1024 * 1024 // 1 MB

/**
 * The service which handles the storage, retrieval, and management of artifacts in the system.
 */
export class ArtifactService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly artifactBackend: ArtifactBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Stores an artifact in the backend and allows caller to set up references.
   * If the artifact already exists, it does nothing.
   *
   * @param projectId The project ID to store the artifact under.
   * @param hash The SHA256 hash of the artifact content.
   * @param size The total size of the artifact in bytes.
   * @param meta The metadata for the artifact.
   * @param content An async iterable providing the artifact content in chunks.
   * @param track A callback to set up artifact references within the transaction.
   * @returns The model of the stored artifact.
   */
  async store(
    projectId: string,
    hash: string,
    size: number,
    meta: CommonObjectMeta,
    content: AsyncIterable<Uint8Array>,
    track: (tx: ProjectTransaction, artifact: Artifact) => Promise<void>,
  ): Promise<Artifact> {
    // check if artifact already exists by hash
    const database = await this.database.forProject(projectId)
    const existingArtifact = await database.artifact.findUnique({ where: { hash } })
    const artifactId = existingArtifact?.id ?? createId()

    // only upload to backend if file doesn't exist there
    if (!existingArtifact || !(await this.artifactBackend.exists(projectId, hash))) {
      if (existingArtifact) {
        this.logger.warn(
          `artifact with hash "%s" exists in database but not in the storage backend, re-uploading`,
          hash,
        )
      }

      await this.artifactBackend.store(projectId, artifactId, artifactChunkSize, content)
    }

    return await database.$transaction(async tx => {
      // create or update the main artifact record
      const artifact = await tx.artifact.upsert({
        where: { id: artifactId },
        create: { id: artifactId, hash, size, meta, chunkSize: artifactChunkSize },
        update: { meta },
      })

      // always allow caller to set up references
      await track(tx, artifact)

      this.logger.info(
        { projectId },
        `stored artifact with hash "%s" and ID "%s"`,
        hash,
        artifact.id,
      )

      return artifact
    })
  }

  /**
   * Removes artifacts with no references and cleans up backend storage.
   *
   * @param projectId The project ID to clean up artifacts for.
   */
  async collectGarbage(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    // find artifacts with no references using Prisma ORM
    const unreferencedArtifacts = await database.artifact.findMany({
      where: {
        AND: [
          { serviceAccounts: { none: {} } },
          { instances: { none: {} } },
          { terminals: { none: {} } },
          { pages: { none: {} } },
        ],
      },
      select: {
        id: true,
        hash: true,
      },
    })

    if (unreferencedArtifacts.length === 0) {
      this.logger.debug({ projectId }, "no unreferenced artifacts found")
      return
    }

    this.logger.info(
      { projectId, count: unreferencedArtifacts.length },
      "collecting garbage artifacts",
    )

    // delete unreferenced artifacts in transaction
    await database.$transaction(async tx => {
      await tx.artifact.deleteMany({
        where: {
          id: { in: unreferencedArtifacts.map(a => a.id) },
        },
      })
    })

    // clean up backend storage for deleted artifacts in foreground
    await Promise.all(
      unreferencedArtifacts.map(async artifact => {
        try {
          await this.artifactBackend.delete(projectId, artifact.hash)
        } catch (error: unknown) {
          this.logger.warn(
            { error, projectId, hash: artifact.hash },
            `failed to delete artifact from backend with hash "%s"`,
            artifact.hash,
          )
        }
      }),
    )

    this.logger.info(
      { projectId, deletedCount: unreferencedArtifacts.length },
      "garbage collection completed",
    )
  }

  /**
   * Gets artifact entities by their IDs.
   *
   * @param projectId The project ID to query artifacts from.
   * @param artifactIds The IDs of the artifacts to retrieve.
   * @returns Array of artifact models.
   */
  async getArtifactsByIds(projectId: string, artifactIds: string[]): Promise<Artifact[]> {
    const database = await this.database.forProject(projectId)

    return await database.artifact.findMany({
      where: {
        id: { in: artifactIds },
      },
    })
  }
}
