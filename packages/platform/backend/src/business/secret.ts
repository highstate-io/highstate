import type { Logger } from "pino"
import type { DatabaseManager, ProjectTransaction } from "../database"
import type { LibraryBackend } from "../library"
import type { PubSubManager } from "../pubsub"
import { randomBytes } from "node:crypto"
import { type CommonObjectMeta, isUnitModel, parseInstanceId } from "@highstate/contract"
import {
  InstanceStateNotFoundError,
  InvalidInstanceKindError,
  ProjectNotFoundError,
  SystemSecretNames,
} from "../shared"

export class SecretService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly libraryBackend: LibraryBackend,
    private readonly logger: Logger,
  ) {}

  /**
   * Updates the secrets for a specific instance within an existing transaction.
   * Only works with unit instances.
   *
   * @param tx The database transaction to use.
   * @param libraryId The ID of the library containing the component.
   * @param stateId The ID of the instance state.
   * @param secretValues The secrets to create or update. Existing secrets not in this update are preserved.
   * @returns The list of secret names that were updated or created.
   */
  async updateInstanceSecretsCore(
    tx: ProjectTransaction,
    libraryId: string,
    stateId: string,
    secretValues: Record<string, unknown>,
  ): Promise<string[]> {
    // verify instance exists and is a unit
    const state = await tx.instanceState.findUnique({
      where: { id: stateId },
      select: { kind: true, instanceId: true },
    })

    if (!state) {
      throw new InstanceStateNotFoundError("", stateId)
    }

    if (state.kind !== "unit") {
      throw new InvalidInstanceKindError("", stateId, "unit", state.kind)
    }

    const library = await this.libraryBackend.loadLibrary(libraryId)

    const [componentType] = parseInstanceId(state.instanceId)
    const component = library.components[componentType]

    if (!component) {
      throw new Error(`Component type "${componentType}" not found in library "${libraryId}"`)
    }

    if (!isUnitModel(component)) {
      throw new Error(`Component type "${componentType}" is not a unit model`)
    }

    // upsert provided secrets
    for (const [secretName, value] of Object.entries(secretValues)) {
      const componentSecret = component.secrets[secretName]
      if (!componentSecret) {
        throw new Error(`Secret "${secretName}" not defined in component "${componentType}"`)
      }

      const meta: CommonObjectMeta = {
        ...componentSecret.meta,

        // fallback to component icon if secret icon is not defined
        icon: componentSecret.meta.icon || component.meta.icon,
        iconColor: componentSecret.meta.iconColor || component.meta.iconColor,
      }

      await tx.secret.upsert({
        where: {
          stateId_name: {
            stateId,
            name: secretName,
          },
        },
        update: {
          meta,
          content: value,
        },
        create: {
          stateId,
          name: secretName,
          meta,
          content: value,
        },
      })
    }

    return Object.keys(secretValues)
  }

  /**
   * Updates secrets for a specific instance, handling creation and updates.
   * Only works with unit instances.
   *
   * @param projectId The project ID containing the instance.
   * @param stateId The ID of the instance state.
   * @param secretValues The secrets to create or update. Existing secrets not in this update are preserved.
   */
  async updateInstanceSecrets(
    projectId: string,
    stateId: string,
    secretValues: Record<string, unknown>,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    const project = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: { libraryId: true },
    })

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    const statePatch = await database.$transaction(async tx => {
      await this.updateInstanceSecretsCore(tx, project.libraryId, stateId, secretValues)

      // invalidate instance state
      const state = await tx.instanceState.update({
        where: { id: stateId },
        data: { inputHashNonce: randomBytes(4).readInt32LE() },
        select: { inputHashNonce: true },
      })

      return { ...state, secretNames: Object.keys(secretValues) }
    })

    this.pubsubManager.publish(["instance-state", projectId], {
      type: "patched",
      stateId,
      patch: statePatch,
    })

    this.logger.info(
      {
        projectId,
        stateId,
        secretCount: Object.keys(secretValues).length,
      },
      "updated instance secrets",
    )
  }

  /**
   * Gets the values of all secrets for a specific instance.
   * Only works with unit instances.
   *
   * @param projectId The project ID containing the instance.
   * @param stateId The ID of the instance state.
   * @returns A record of secret key-value pairs.
   */
  async getInstanceSecretValues(
    projectId: string,
    stateId: string,
  ): Promise<Record<string, unknown>> {
    const database = await this.database.forProject(projectId)

    // verify instance exists and is a unit
    const state = await database.instanceState.findUnique({
      where: { id: stateId },
      select: { kind: true },
    })

    if (!state) {
      throw new InstanceStateNotFoundError(projectId, stateId)
    }

    if (state.kind !== "unit") {
      throw new InvalidInstanceKindError(projectId, stateId, "unit", state.kind)
    }

    const secrets = await database.secret.findMany({
      where: {
        stateId,
        name: { not: null },
      },
    })

    const values: Record<string, unknown> = {}

    for (const secret of secrets) {
      if (secret.name) {
        values[secret.name] = secret.content
      }
    }

    return values
  }

  /**
   * Gets or creates the Pulumi password secret for the given project.
   * Uses the new direct systemName field approach.
   *
   * @param projectId The ID of the project for which to get or create the Pulumi password.
   * @returns The Pulumi password.
   */
  async getPulumiPassword(projectId: string): Promise<string> {
    const database = await this.database.forProject(projectId)

    return await database.$transaction(async tx => {
      const existingSecret = await tx.secret.findUnique({
        where: {
          systemName: SystemSecretNames.PulumiPassword,
        },
      })

      if (existingSecret) {
        return existingSecret.content as string
      }

      const newPassword = randomBytes(32).toString("hex")

      await tx.secret.create({
        data: {
          systemName: SystemSecretNames.PulumiPassword,
          meta: {
            title: "Pulumi Password",
            description: "The password used to encrypt the Pulumi state.",
            icon: "devicon:pulumi",
          },
          content: newPassword,
        },
      })

      this.logger.info({ projectId }, "created new Pulumi password")
      return newPassword
    })
  }
}
