import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { PubSubManager } from "../pubsub"
import type { ProjectUnlockBackend } from "../unlock"
import { randomBytes } from "node:crypto"
import { armor, Decrypter, Encrypter } from "age-encryption"
import { z } from "zod"
import { createProjectLogger } from "../common"
import {
  CannotDeleteLastUnlockMethodError,
  ProjectNotFoundError,
  type ProjectUnlockState,
  type ProjectUnlockSuite,
  type UnlockMethodInput,
} from "../shared"

type UnlockTask = {
  name: string
  handler: (projectId: string) => Promise<void> | void
}

export const projectUnlockServiceConfig = z.object({
  HIGHSTATE_ENCRYPTION_ENABLED: z.stringbool().default(true),
  HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS: z
    .string()
    .transform(val => val?.split(",") ?? [])
    .default([]),
})

export class ProjectUnlockService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly projectUnlockBackend: ProjectUnlockBackend,
    private readonly config: z.infer<typeof projectUnlockServiceConfig>,
    private readonly logger: Logger,
  ) {}

  private readonly unlockTasks: UnlockTask[] = []

  /**
   * Gets the current unlock state of the project.
   * If the project is unlocked, it returns an object with type "unlocked".
   * If the project is locked, it returns an object with type "locked" and the unlock suite.
   *
   * @param projectId The ID of the project to get the unlock state for.
   * @returns The unlock state of the project.
   */
  async getProjectUnlockState(projectId: string): Promise<ProjectUnlockState> {
    const isUnlocked = await this.projectUnlockBackend.checkProjectUnlocked(projectId)
    if (isUnlocked) {
      return { type: "unlocked" }
    }

    const project = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: { unlockSuite: true },
    })

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    return {
      type: "locked",
      unlockSuite: project.unlockSuite,
    }
  }

  /**
   * Sets up the project database by creating a master key and unlock suite with the provided unlock method.
   *
   * Creates databases, configures encryption and persists the unlock method inside the project database.
   *
   * Then returns the encrypted master key and the unlock suite for further persisting in the backend database.
   *
   * @param projectId The ID of the project to create the state for.
   * @param unlockMethod The unlock method to use to encrypt the master key. Should be provided by the frontend.
   */
  async setupProjectDatabase(
    projectId: string,
    unlockMethodInput: UnlockMethodInput,
  ): Promise<[encryptedMasterKey: string, unlockSuite: ProjectUnlockSuite]> {
    // generate a new master key for the project
    const masterKey = randomBytes(32)

    // set the master key to setup the database encryption
    await this.projectUnlockBackend.unlockProject(projectId, masterKey)

    const encryptedMasterKey = await this.encryptProjectMasterKey(projectId, [unlockMethodInput])

    const database = await this.database.setupDatabase(projectId)

    // persist unlock method (now we can do it since the database is set up and unlocked)
    await database.unlockMethod.create({ data: unlockMethodInput })

    const unlockSuite: ProjectUnlockSuite = {
      encryptedIdentities: [unlockMethodInput.encryptedIdentity],
      hasPasskey: unlockMethodInput.type === "passkey",
    }

    return [encryptedMasterKey, unlockSuite]
  }

  /**
   * Unlocks the project state using the provided identity.
   *
   * @param projectId The ID of the project to unlock.
   * @param decryptedIdentity The decrypted identity to use for unlocking the project. Should be provided by the frontend.
   */
  async unlockProject(projectId: string, decryptedIdentity: string): Promise<void> {
    if (await this.projectUnlockBackend.checkProjectUnlocked(projectId)) {
      this.logger.warn(
        { projectId },
        `project "%s" is already unlocked, skipping unlock operation`,
        projectId,
      )
      return
    }

    // load the encrypted master key for the project
    const project = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: { encryptedMasterKey: true },
    })

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    if (!this.config.HIGHSTATE_ENCRYPTION_ENABLED) {
      // no cryptography, just unlock with an empty master key
      await this.projectUnlockBackend.unlockProject(projectId, Buffer.alloc(0))
      await this.pubsubManager.publish(["project-unlock-state", projectId], { type: "unlocked" })
      await this.runUnlockTasks(projectId)
      return
    }

    const encryptedMasterKey = armor.decode(project.encryptedMasterKey)

    const decrypter = new Decrypter()
    decrypter.addIdentity(decryptedIdentity)

    // decrypt the master key using the provided identity
    const masterKey = await decrypter.decrypt(encryptedMasterKey)

    // unlock the project in the backend
    await this.projectUnlockBackend.unlockProject(projectId, Buffer.from(masterKey))
    await this.pubsubManager.publish(["project-unlock-state", projectId], { type: "unlocked" })

    // run unlock tasks
    await this.runUnlockTasks(projectId)
  }

  private async runUnlockTasks(projectId: string): Promise<void> {
    for (const task of this.unlockTasks) {
      try {
        await task.handler(projectId)
      } catch (error) {
        this.logger.error({ error }, `unlock task "%s" failed`, task.name)
      }
    }
  }

  /**
   * Adds a new unlock method to the project and updates the master identity set.
   * The project must be unlocked.
   *
   * @param projectId The ID of the project to add the unlock method to.
   * @param inputUnlockMethod The unlock method to add. Should be provided by the frontend.
   */
  async addProjectUnlockMethod(
    projectId: string,
    inputUnlockMethod: UnlockMethodInput,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      // 1. fetch all unlock method recipients for the project
      const unlockMethods = await tx.unlockMethod.findMany({
        select: { type: true, recipient: true, encryptedIdentity: true },
      })

      const allUnlockMethods = [...unlockMethods, inputUnlockMethod]

      // 2. encrypt the project data for all recipients + the new recipient
      const encryptedMasterKey = await this.encryptProjectMasterKey(projectId, allUnlockMethods)

      // 3. persist the new unlock method
      await tx.unlockMethod.create({ data: inputUnlockMethod })

      // 4. update the project with the new master key and unlock suite
      await this.database.backend.project.update({
        where: { id: projectId },
        data: {
          encryptedMasterKey,
          unlockSuite: ProjectUnlockService.createUnlockSuite(allUnlockMethods),
        },
      })
    })
  }

  /**
   * Removes an unlock method from the project and updates the master identity set.
   * The project must be unlocked.
   *
   * @param projectId The ID of the project to remove the unlock method from.
   * @param unlockMethodId The ID of the unlock method to remove.
   */
  async removeProjectUnlockMethod(projectId: string, unlockMethodId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      // 1. fetch all unlock methods except the one to remove
      const unlockMethods = await tx.unlockMethod.findMany({
        where: { id: { not: unlockMethodId } },
        select: { type: true, recipient: true, encryptedIdentity: true },
      })

      if (unlockMethods.length === 0) {
        throw new CannotDeleteLastUnlockMethodError(projectId)
      }

      // 2. encrypt the project data for remaining recipients
      const encryptedMasterKey = await this.encryptProjectMasterKey(projectId, unlockMethods)

      // 3. delete the unlock method
      await tx.unlockMethod.delete({ where: { id: unlockMethodId } })

      // 4. update the project with the new master key and unlock suite
      await this.database.backend.project.update({
        where: { id: projectId },
        data: {
          encryptedMasterKey,
          unlockSuite: ProjectUnlockService.createUnlockSuite(unlockMethods),
        },
      })
    })
  }

  /**
   * Registers a new unlock task that will be executed when the project is unlocked.
   * This can be used to perform additional actions after unlocking, such as loading instance states.
   *
   * @param name The name of the unlock task.
   * @param handler The handler function for the unlock task. It receives the project ID as an argument.
   */
  registerUnlockTask(name: string, handler: (projectId: string) => Promise<void> | void): void {
    this.unlockTasks.push({ name, handler })
  }

  private async encryptProjectMasterKey(
    projectId: string,
    unlockMethods: { recipient: string }[],
  ): Promise<string> {
    const masterKey = await this.database.getProjectMasterKey(projectId)
    if (!masterKey) {
      // окак
      return "encryption disabled"
    }

    // encrypt the master key for all unlock methods
    const encrypter = new Encrypter()
    for (const unlockMethod of unlockMethods) {
      encrypter.addRecipient(unlockMethod.recipient)
    }

    const encryptedMasterKey = await encrypter.encrypt(masterKey)
    const armoredMasterKey = armor.encode(encryptedMasterKey)

    return armoredMasterKey
  }

  /**
   * Auto-unlocks the projects for the development environment.
   */
  async autoUnlockProjects(): Promise<void> {
    // just mark the projects as unlocked with an empty master key and run unlock tasks
    for (const projectId of this.config.HIGHSTATE_DEV_AUTO_UNLOCK_PROJECT_IDS) {
      const logger = createProjectLogger(this.logger, projectId)

      try {
        logger.info("auto-unlocking project (dev mode)")

        await this.projectUnlockBackend.unlockProject(projectId, Buffer.alloc(0))
        await this.pubsubManager.publish(["project-unlock-state", projectId], { type: "unlocked" })
        await this.runUnlockTasks(projectId)
      } catch (error) {
        logger.error({ error }, "failed to auto-unlock project")
      }
    }
  }

  private static createUnlockSuite(
    unlockMethods: { type: string; encryptedIdentity: string }[],
  ): ProjectUnlockSuite {
    return {
      encryptedIdentities: unlockMethods.map(method => method.encryptedIdentity),
      hasPasskey: unlockMethods.some(method => method.type === "passkey"),
    }
  }
}
