import { armor, Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption"
import { ProjectKeyringStorage } from "./project-keyring-storage"

const accountName = "identity"

type KeyringUnlockEnvelope = { recipient: string; encryptedIdentity: string }

/**
 * Protects project unlock identities with one AGE wrapping identity in the host's OS keyring.
 */
export class ProjectKeyring {
  constructor(
    private readonly storage: Pick<
      ProjectKeyringStorage,
      "read" | "write" | "probe"
    > = new ProjectKeyringStorage(),
  ) {}

  private creatingIdentity?: Promise<string>

  /**
   * Checks read/write access without creating or replacing the shared identity.
   */
  async checkAvailable(): Promise<void> {
    await this.storage.probe()
  }

  /**
   * Creates a project-local unlock envelope using the shared keyring wrapping identity.
   */
  async getOrCreateEnvelope(): Promise<KeyringUnlockEnvelope> {
    try {
      this.creatingIdentity ??= this.getOrCreateIdentity()
      let wrappingIdentity: string

      try {
        wrappingIdentity = await this.creatingIdentity
      } finally {
        this.creatingIdentity = undefined
      }

      const identity = await generateIdentity()
      const encrypter = new Encrypter()
      encrypter.addRecipient(await identityToRecipient(wrappingIdentity))
      const encryptedIdentity = armor.encode(await encrypter.encrypt(identity))

      return { recipient: await identityToRecipient(identity), encryptedIdentity }
    } catch (error) {
      throw new Error("Failed to prepare the system keyring unlock identity", { cause: error })
    }
  }

  /**
   * Decrypts a project's unlock envelope using the existing keyring wrapping identity.
   * Missing credentials and envelopes that do not match the unlock recipient fail without regeneration.
   */
  async getIdentity(recipient: string, encryptedIdentity: string): Promise<string> {
    const wrappingIdentity = await this.readIdentity()
    if (!wrappingIdentity) {
      throw new Error(
        "This project's system keyring identity is not available on this backend; use another unlock method and add this backend's system keyring",
      )
    }

    const decrypter = new Decrypter()
    decrypter.addIdentity(wrappingIdentity)
    const identity = await decrypter.decrypt(armor.decode(encryptedIdentity), "text")
    if ((await identityToRecipient(identity)) !== recipient) {
      throw new Error("The system keyring identity does not match this project's unlock recipient")
    }

    return identity
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
