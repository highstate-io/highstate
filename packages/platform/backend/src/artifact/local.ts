import type { Logger } from "pino"
import type z from "zod"
import type { ArtifactBackend } from "./abstractions"
import { createReadStream, createWriteStream } from "node:fs"
import { access, mkdir, readdir, rm, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"
import { codebaseConfig, createProjectLogger, getCodebaseHighstatePath } from "../common"

export const localArtifactBackendConfig = codebaseConfig

/**
 * A local artifact backend that stores artifacts in the filesystem.
 *
 * File structure:
 * - `{codebase}/.highstate/projects/{projectId}/artifacts/{id}.{extension}`
 */
export class LocalArtifactBackend implements ArtifactBackend {
  constructor(
    private readonly hsCodebasePath: string,
    private readonly extension: string,
    private readonly logger: Logger,
  ) {}

  async store(
    projectId: string,
    artifactId: string,
    chunkSize: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const logger = createProjectLogger(this.logger, projectId)
    const [baseDir, fileName] = this.getArtifactPath(projectId, artifactId)
    await mkdir(baseDir, { recursive: true })

    // check if the artifact already exists
    try {
      await access(fileName)
      logger.debug({ artifactId }, "artifact already exists")
      return
    } catch {
      // artifact does not exist, continue with storing
    }

    const file = createWriteStream(fileName, { highWaterMark: chunkSize })
    logger.debug({ artifactId, fileName }, "opened file for writing")

    for await (const chunk of content) {
      file.write(chunk)
    }

    file.end()
    logger.info({ artifactId, fileName }, "artifact stored")
  }

  async retrieve(
    projectId: string,
    artifactId: string,
    chunkSize: number,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const logger = createProjectLogger(this.logger, projectId)
    const [, fileName] = this.getArtifactPath(projectId, artifactId)

    try {
      return Promise.resolve(createReadStream(fileName, { highWaterMark: chunkSize }))
    } catch (error) {
      logger.debug({ hash: artifactId, error }, "artifact retrieval failed")
      return null
    }
  }

  async delete(projectId: string, hash: string): Promise<void> {
    const logger = createProjectLogger(this.logger, projectId)
    const [baseDir, fileName] = this.getArtifactPath(projectId, hash)

    try {
      await unlink(fileName)
      await this.deleteDirectoryIfEmpty(baseDir, logger)
      logger.info({ hash, fileName }, "artifact deleted")
    } catch (error) {
      logger.error({ hash, fileName, error }, "artifact deletion failed")
    }
  }

  async deleteDirectoryIfEmpty(dirPath: string, logger: Logger): Promise<void> {
    try {
      const files = await readdir(dirPath)
      if (files.length === 0) {
        await rm(dirPath)
        logger.info({ dirPath }, "deleted empty directory")
      } else {
        logger.debug({ dirPath, fileCount: files.length }, "directory not empty, skipping deletion")
      }
    } catch (error) {
      logger.error({ dirPath, error }, "failed to delete directory")
    }
  }

  async exists(projectId: string, artifactId: string): Promise<boolean> {
    const [, fileName] = this.getArtifactPath(projectId, artifactId)

    try {
      await access(fileName)
      return true
    } catch {
      return false
    }
  }

  private getArtifactPath(
    projectId: string,
    artifactId: string,
  ): [baseDir: string, fileName: string] {
    const baseDir = resolve(this.hsCodebasePath, "projects", projectId, "artifacts")
    const fileName = join(baseDir, `${artifactId}${this.extension}`)

    return [baseDir, fileName]
  }

  static async create(
    config: z.infer<typeof codebaseConfig>,
    extension: string,
    logger: Logger,
  ): Promise<LocalArtifactBackend> {
    const serviceLogger = logger.child({ service: "LocalArtifactBackend" })
    const codebasePath = await getCodebaseHighstatePath(config, logger)

    return new LocalArtifactBackend(codebasePath, extension, serviceLogger)
  }
}
