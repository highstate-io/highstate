import type { Logger } from "pino"
import type { ArtifactBackend, ArtifactService } from "../artifact"
import type { Artifact } from "../database"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { type UnitArtifact, unitArtifactId } from "@highstate/contract"

export interface ArtifactEnvironment {
  readPath: string | null
  writePath: string
}

/**
 * Sets up artifact environment for a runner operation.
 * Downloads all required artifacts to a temporary directory for reading,
 * and creates a separate directory for writing new artifacts.
 */
export async function setupArtifactEnvironment(
  projectId: string,
  artifacts: Artifact[],
  artifactBackend: ArtifactBackend,
  tempBasePath: string,
  logger: Logger,
): Promise<ArtifactEnvironment> {
  // create temporary directory for writing new artifacts using mkdtemp
  const writeDir = await mkdtemp(join(tempBasePath, "highstate-artifacts-write-"))

  let readDir: string | null = null

  if (artifacts.length > 0) {
    // create temporary directory for reading existing artifacts using mkdtemp
    readDir = await mkdtemp(join(tempBasePath, "highstate-artifacts-read-"))

    logger.debug({
      msg: "created artifact temp directories",
      readDir,
      writeDir,
      artifactCount: artifacts.length,
    })

    // download all artifacts to read directory
    await Promise.all(
      artifacts.map(async artifact => {
        const artifactPath = join(readDir!, `${artifact.hash}.tgz`)
        const stream = await artifactBackend.retrieve(projectId, artifact.id, artifact.chunkSize)

        if (!stream) {
          throw new Error(`artifact not found: ${artifact.hash}`)
        }

        const writeStream = createWriteStream(artifactPath)
        await pipeline(stream, writeStream)

        logger.debug({ msg: "downloaded artifact", id: artifact.id, path: artifactPath })
      }),
    )
  } else {
    logger.debug({
      msg: "created artifact write directory only",
      writeDir,
    })
  }

  return { readPath: readDir, writePath: writeDir }
}

/**
 * Collects all artifacts from the write directory and stores them in the artifact backend.
 */
export async function collectAndStoreArtifacts(
  writePath: string,
  projectId: string,
  stateId: string,
  artifactManager: ArtifactService,
  declaredArtifacts: UnitArtifact[],
  logger: Logger,
): Promise<void> {
  try {
    const files = await readdir(writePath)
    const tgzFiles = files.filter(file => file.endsWith(".tgz"))

    if (tgzFiles.length === 0) {
      logger.debug({ msg: "no artifacts to collect", writePath })
      return
    }

    const artifactFiles = tgzFiles
      .map(file => {
        const hash = file.replace(".tgz", "")
        const declaredArtifact = declaredArtifacts.find(artifact => artifact.hash === hash)

        if (!declaredArtifact) {
          logger.warn({
            msg: "artifact file not declared in outputs",
            file,
            declaredArtifacts,
          })
          return null
        }

        return { file, artifact: declaredArtifact }
      })
      .filter(file => file !== null)

    await Promise.all(
      artifactFiles.map(async ({ file, artifact }) => {
        const filePath = join(writePath, file)

        try {
          const [expectedHash, fileSize] = await getFileSha256(filePath)
          if (expectedHash !== artifact.hash) {
            logger.warn({
              msg: "artifact hash mismatch",
              expectedHash,
              gotHash: artifact.hash,
              file: filePath,
            })
            return
          }

          await using readStream = createReadStream(filePath)

          const storedArtifact = await artifactManager.store(
            projectId,
            expectedHash,
            fileSize,
            artifact.meta ?? { title: `Artifact for "${stateId}"` },
            readStream,
            async (tx, storedArtifact) => {
              await tx.instanceState.update({
                where: { id: stateId },
                data: {
                  artifacts: {
                    connect: { id: storedArtifact.id },
                  },
                },
              })
            },
          )

          artifact[unitArtifactId] = storedArtifact.id

          logger.debug({ msg: "stored artifact", hash: expectedHash, file: filePath })
        } catch (error) {
          logger.error({ msg: "failed to store artifact", file: filePath, error })
          throw error
        }
      }),
    )
  } catch (error) {
    logger.error({ msg: "failed to collect artifacts", writePath, error })
    throw error
  }
}

export async function getFileSha256(filePath: string): Promise<[string, number]> {
  await using fileContent = createReadStream(filePath)
  const hash = createHash("sha256")
  let size = 0

  for await (const chunk of fileContent) {
    const buffer = chunk as Buffer

    hash.update(buffer)
    size += buffer.length
  }

  return [hash.digest("hex"), size]
}
