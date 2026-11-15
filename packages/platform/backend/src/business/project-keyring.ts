import { randomUUID } from "node:crypto"
import { AsyncEntry, findCredentialsAsync } from "@napi-rs/keyring"
import { generateIdentity, identityToRecipient } from "age-encryption"

const serviceName = "io.highstate.project-unlock"
const accountName = "identity"

/**
 * Stores one AGE identity for project unlocking in the backend host's OS keyring.
 */
export class ProjectKeyring {
  private creatingIdentity?: Promise<string>

  /**
   * Checks read/write access without creating or replacing the shared identity.
   */
  async checkAvailable(): Promise<void> {
    const entry = new AsyncEntry(serviceName, `probe:${randomUUID()}`)
    const value = randomUUID()
    let created = false

    try {
      await entry.setPassword(value)
      created = true

      if ((await entry.getPassword()) !== value) {
        throw new Error("System keyring did not return the stored value")
      }
    } finally {
      if (created) {
        await entry.deleteCredential()
      }
    }
  }

  /**
   * Returns the shared recipient, creating the identity only when none exists.
   */
  async getOrCreateRecipient(): Promise<string> {
    this.creatingIdentity ??= this.getOrCreateIdentity()

    try {
      return await identityToRecipient(await this.creatingIdentity)
    } finally {
      this.creatingIdentity = undefined
    }
  }

  /**
   * Loads the existing identity without regenerating a missing credential.
   */
  async getIdentity(recipient: string): Promise<string> {
    const identity = await this.readIdentity()
    if (!identity || (await identityToRecipient(identity)) !== recipient) {
      throw new Error(
        "This project's system keyring identity is not available on this backend; use another unlock method and add this backend's system keyring",
      )
    }

    return identity
  }

  private async readIdentity(): Promise<string | undefined> {
    try {
      const credentials = await findCredentialsAsync(serviceName)
      return credentials.find(entry => entry.account === accountName)?.password
    } catch (error) {
      throw new Error("Failed to read the project unlock identity from the system keyring", {
        cause: error,
      })
    }
  }

  private async getOrCreateIdentity(): Promise<string> {
    const existing = await this.readIdentity()
    if (existing) {
      await identityToRecipient(existing)
      return existing
    }

    const identity = await generateIdentity()
    const entry = new AsyncEntry(serviceName, accountName)

    try {
      await entry.setPassword(identity)

      if ((await entry.getPassword()) !== identity) {
        throw new Error("System keyring did not return the stored identity")
      }
    } catch (error) {
      throw new Error("Failed to store the project unlock identity in the system keyring", {
        cause: error,
      })
    }

    return identity
  }
}
