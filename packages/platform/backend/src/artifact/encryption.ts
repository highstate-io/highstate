import type { DatabaseManager } from "../database"
import type { ArtifactBackend } from "./abstractions"
import { xchacha20poly1305 } from "@noble/ciphers/chacha"
import { managedNonce } from "@noble/ciphers/webcrypto"

const nonceSize = 24

/**
 * The ArtifactBackend decorator that adds encryption and key obfuscation to the artifact storage.
 */
export class EncryptionArtifactBackend implements ArtifactBackend {
  constructor(
    private readonly artifactBackend: ArtifactBackend,
    private readonly database: DatabaseManager,
  ) {}

  async store(
    projectId: string,
    artifactId: string,
    chunkSize: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const encryptedContent = this.getEncryptedContent(projectId, content)

    await this.artifactBackend.store(projectId, artifactId, chunkSize + nonceSize, encryptedContent)
  }

  private async *getEncryptedContent(
    projectId: string,
    content: AsyncIterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    const masterKey = await this.database.getProjectMasterKey(projectId)
    if (!masterKey) {
      throw new Error(`No master key found for project ${projectId}`)
    }

    const xchacha = managedNonce(xchacha20poly1305)(masterKey)

    for await (const chunk of content) {
      yield xchacha.encrypt(chunk)
    }
  }

  async retrieve(
    projectId: string,
    artifactId: string,
    chunkSize: number,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const encryptedContent = await this.artifactBackend.retrieve(
      projectId,
      artifactId,
      chunkSize + nonceSize,
    )

    if (encryptedContent === null) {
      return null
    }

    return this.getDecryptedContent(projectId, encryptedContent)
  }

  private async *getDecryptedContent(
    projectId: string,
    encryptedContent: AsyncIterable<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    const masterKey = await this.database.getProjectMasterKey(projectId)
    if (!masterKey) {
      throw new Error(`No master key found for project ${projectId}`)
    }

    const xchacha = managedNonce(xchacha20poly1305)(masterKey)

    for await (const chunk of encryptedContent) {
      yield xchacha.decrypt(chunk)
    }
  }

  async delete(projectId: string, hash: string): Promise<void> {
    return await this.artifactBackend.delete(projectId, hash)
  }

  async exists(projectId: string, hash: string): Promise<boolean> {
    return await this.artifactBackend.exists(projectId, hash)
  }
}
