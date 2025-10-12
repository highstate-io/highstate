import type { Logger } from "pino"
import type { BackendUnlockMethod, DatabaseManager } from "../database"
import {
  type BackendUnlockMethodInput,
  BackendUnlockMethodNotFoundError,
  CannotDeleteLastBackendUnlockMethodError,
} from "../shared"

export class BackendUnlockService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Lists backend unlock methods ordered by creation time.
   *
   * @returns The ordered unlock method collection.
   */
  async listUnlockMethods(): Promise<BackendUnlockMethod[]> {
    return await this.database.backend.backendUnlockMethod.findMany({
      orderBy: { createdAt: "asc" },
    })
  }

  /**
   * Stores a new unlock method and refreshes master-key recipients.
   *
   * @param input Unlock method payload gathered from the CLI or automation.
   * @returns The persisted unlock method.
   */
  async addUnlockMethod(input: BackendUnlockMethodInput): Promise<BackendUnlockMethod> {
    const record = await this.database.backend.backendUnlockMethod.create({ data: input })

    await this.reencryptBackendMasterKey()

    return record
  }

  /**
   * Removes an unlock method by identifier and rotates the encrypted master key.
   *
   * @param id Identifier of the unlock method to delete.
   */
  async deleteUnlockMethod(id: string): Promise<void> {
    const methods = await this.database.backend.backendUnlockMethod.findMany()
    const method = methods.find(m => m.id === id)
    if (!method) {
      throw new BackendUnlockMethodNotFoundError(id)
    }

    if (methods.length === 1) {
      throw new CannotDeleteLastBackendUnlockMethodError()
    }

    await this.database.backend.backendUnlockMethod.delete({ where: { id } })
    await this.reencryptBackendMasterKey()
  }

  private async reencryptBackendMasterKey(): Promise<void> {
    if (!this.database.isEncryptionEnabled) {
      return
    }

    const recipients = await this.database.backend.backendUnlockMethod.findMany({
      select: { recipient: true },
    })

    await this.database.updateBackendUnlockRecipients(recipients.map(method => method.recipient))

    this.logger.debug(
      { recipientCount: recipients.length },
      "updated backend master key recipients",
    )
  }
}
