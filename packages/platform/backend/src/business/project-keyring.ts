import { armor, Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { ProjectKeyringStorage } from "./project-keyring-storage"

const accountName = "identity"
const envelopeAccountName = "unlock-envelope"

type KeyringUnlockEnvelope = { recipient: string; encryptedIdentity: string }

/**
 * Protects a shared unlock identity with an AGE wrapping identity in the host's OS keyring.
 */
export class ProjectKeyring {
  constructor(
    private readonly storage: Pick<
      ProjectKeyringStorage,
      "read" | "write" | "probe"
    > = new ProjectKeyringStorage(),
  ) {}

  private creatingEnvelope?: Promise<KeyringUnlockEnvelope>

  /**
   * Checks read/write access without creating or replacing the shared identity.
   */
  async checkAvailable(): Promise<void> {
    await this.storage.probe()
  }

  /**
   * Returns the shared encrypted unlock identity, creating it only when none exists.
   */
  async getOrCreateEnvelope(): Promise<KeyringUnlockEnvelope> {
    this.creatingEnvelope ??= this.createOrReadEnvelope()

    try {
      return await this.creatingEnvelope
    } catch (error) {
      throw new Error("Failed to prepare the system keyring unlock identity", { cause: error })
    } finally {
      this.creatingEnvelope = undefined
    }
  }

  /**
   * Decrypts a project's unlock envelope using the existing keyring wrapping identity.
   * Omitting the envelope supports legacy methods whose recipient belongs to the wrapping identity.
   * Missing credentials and envelopes that do not match the unlock recipient fail without regeneration.
   */
  async getIdentity(recipient: string, encryptedIdentity?: string): Promise<string> {
    const wrappingIdentity = await this.readIdentity()
    if (!wrappingIdentity) {
      throw new Error(
        "This project's system keyring identity is not available on this backend; use another unlock method and add this backend's system keyring",
      )
    }

    let identity = wrappingIdentity

    if (encryptedIdentity) {
      const decrypter = new Decrypter()
      decrypter.addIdentity(wrappingIdentity)
      identity = await decrypter.decrypt(armor.decode(encryptedIdentity), "text")
    }

    if ((await identityToRecipient(identity)) !== recipient) {
      throw new Error("The system keyring identity does not match this project's unlock recipient")
    }

    return identity
  }

  private async createOrReadEnvelope(): Promise<KeyringUnlockEnvelope> {
    const credentials = await this.storage.read()

    const existingEnvelope = credentials.find(
      entry => entry.account === envelopeAccountName,
    )?.password

    const existingWrapper = credentials.find(entry => entry.account === accountName)?.password
    if (existingEnvelope && !existingWrapper) {
      throw new Error(
        "The system keyring wrapping identity is missing; restore it or use another unlock method",
      )
    }

    const wrappingIdentity = existingWrapper ?? (await this.getOrCreateIdentity())

    if (existingEnvelope) {
      const decrypter = new Decrypter()
      decrypter.addIdentity(wrappingIdentity)
      const identity = await decrypter.decrypt(armor.decode(existingEnvelope), "text")
      return { recipient: await identityToRecipient(identity), encryptedIdentity: existingEnvelope }
    }

    const identity = await generateIdentity()
    const encrypter = new Encrypter()
    encrypter.addRecipient(await identityToRecipient(wrappingIdentity))
    const encryptedIdentity = armor.encode(await encrypter.encrypt(identity))
    await this.storage.write(envelopeAccountName, encryptedIdentity)

    return { recipient: await identityToRecipient(identity), encryptedIdentity }
  }

  private async readIdentity(): Promise<string | undefined> {
    try {
      const credentials = await this.storage.read()
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

    try {
      await this.storage.write(accountName, identity)
    } catch (error) {
      throw new Error("Failed to store the project unlock identity in the system keyring", {
        cause: error,
      })
    }

    return identity
  }
}
