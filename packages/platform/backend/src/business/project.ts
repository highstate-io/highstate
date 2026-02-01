import type { InputJsonValue } from "@prisma/client/runtime/client"
import type { Logger } from "pino"
import type { LibraryBackend } from "../library"
import type { PubSubManager } from "../pubsub"
import type { ProjectModelService } from "./project-model"
import type { ProjectUnlockService } from "./project-unlock"
import {
  type HubModel,
  type HubModelPatch,
  type InstanceId,
  type InstanceModel,
  type InstanceModelPatch,
  instanceModelSchema,
  isUnitModel,
  parseInstanceId,
} from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import { createProjectLogger } from "../common"
import { type DatabaseManager, type Project, projectDatabaseVersion } from "../database"
import {
  applyInstancePatch,
  type ProjectEvaluationSubsystem,
  type ProjectModelBackend,
  ProjectModelError,
  ProjectModelInstanceNotFoundError,
} from "../project-model"
import {
  type FullProjectModel,
  forSchema,
  type ProjectInput,
  type ProjectModelStorageSpec,
  ProjectNotFoundError,
  type ProjectOutput,
  projectOutputSchema,
  type UnlockMethodInput,
} from "../shared"
import { includeForInstanceState, mapInstanceStateResult } from "./instance-state"

export class ProjectService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly projectEvaluationSubsystem: ProjectEvaluationSubsystem,
    private readonly projectModelService: ProjectModelService,
    private readonly projectModelBackends: Record<string, ProjectModelBackend>,
    private readonly libraryBackend: LibraryBackend,
    private readonly pubsubManager: PubSubManager,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns all projects in the system.
   */
  async getProjects(): Promise<ProjectOutput[]> {
    return await this.database.backend.project.findMany({
      select: forSchema(projectOutputSchema),
    })
  }

  /**
   * Creates a new project with the given input and unlock method.
   *
   * This will set up the project database and persist the unlock method.
   *
   * @param projectInput The input for the new project.
   * @param unlockMethodInput The unlock method to use for the new project.
   */
  async createProject(
    projectInput: ProjectInput,
    unlockMethodInput: UnlockMethodInput,
  ): Promise<Project> {
    // start by generating a random ID
    const projectId = createId()
    const logger = createProjectLogger(this.logger, projectId)

    logger.info("creating new project")

    // setup project database
    const [encryptedMasterKey, unlockSuite] = await this.projectUnlockService.setupProjectDatabase(
      projectId,
      unlockMethodInput,
    )

    logger.info("project database set up")

    // finally, create the project in the database
    const project = await this.database.backend.project.create({
      data: {
        id: projectId,
        name: projectInput.name,
        meta: projectInput.meta,
        databaseVersion: projectDatabaseVersion,
        encryptedMasterKey,
        unlockSuite,
        spaceId: projectInput.spaceId,
        modelStorageId: projectInput.modelStorageId,
        libraryId: projectInput.libraryId,
        pulumiBackendId: projectInput.pulumiBackendId,
      },
    })

    logger.info("project successfully created")

    return project
  }

  /**
   * Returns the project with the given ID.
   *
   * If the project does not exist, this will throw an error.
   *
   * @param projectId The ID of the project to get.
   */
  async getProjectOrThrow(projectId: string): Promise<ProjectOutput> {
    const project = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: forSchema(projectOutputSchema),
    })

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    return project
  }

  /**
   * Get the project model containing instances, hubs + virtual and ghost instances.
   *
   * @param projectId The ID of the project to get the model for.
   * @param signal Optional abort signal for cancellation.
   */
  async getProjectModel(projectId: string): Promise<FullProjectModel> {
    const [projectModel] = await this.projectModelService.getProjectModel(projectId, {
      includeVirtualInstances: true,
      includeGhostInstances: true,
    })

    return projectModel
  }

  /**
   * Rename an instance in the project.
   *
   * @param projectId The ID of the project containing the instance.
   * @param instanceId The ID of the instance to rename.
   * @param newName The new name for the instance.
   */
  async renameInstance(
    projectId: string,
    instanceId: InstanceId,
    newName: string,
  ): Promise<InstanceModel> {
    try {
      // rename the instance in the model
      const { project, backend, spec } = await this.getProjectWithBackend(projectId)
      const instance = await backend.renameInstance(project, spec, instanceId, newName)

      // rename in the database state
      const database = await this.database.forProject(projectId)

      await database.$transaction(async tx => {
        const state = await tx.instanceState.findUnique({
          where: { instanceId },
          select: { id: true },
        })

        if (!state) {
          // ignore if state doesn't exist yet
          return
        }

        await tx.instanceState.update({
          where: { id: state.id },
          data: { instanceId: instance.id },
        })

        // if the instance is composite, we also need to rename all child instance states
        // we will replace all old instance name occurrences with the new names
        // this will not work in general, since child IDs may be arbitrary strings:
        // e.g. we have parent with name "foo" and child with name pattern "{parent}-foo"
        // if we rename parent to "bar", the child should be renamed to "bar-foo",
        // but will be renamed to "bar-bar" with this approach, leading to child recreation
        // it is not ideal, but this is the best we can do in the current evaluation model

        if (instance.kind !== "composite") {
          return
        }

        const [, oldName] = parseInstanceId(instanceId)

        // TODO: use proper SQL to do this in the database instead of in memory
        const allStates = await tx.instanceState.findMany({
          where: { source: "virtual" },
          select: { id: true, parentId: true, instanceId: true },
        })

        const stateMap = new Map<string, { parentId: string | null }>()
        for (const s of allStates) {
          stateMap.set(s.instanceId, s)
        }

        const isChild = (s: { parentId: string | null }) => {
          while (s.parentId) {
            if (s.parentId === state.id) {
              return true
            }

            const parent = stateMap.get(s.parentId)
            if (!parent) {
              break
            }

            s = parent
          }

          return false
        }

        for (const childState of allStates) {
          if (!isChild(childState)) {
            // reduce the scope of replacement to only child instances to reduce risk of incorrect renames
            continue
          }

          const newChildInstanceId = childState.instanceId.replace(oldName, newName)
          if (newChildInstanceId === childState.instanceId) {
            continue
          }

          await tx.instanceState.update({
            where: { id: childState.id },
            data: { instanceId: newChildInstanceId },
          })
        }
      })

      await this.pubsubManager.publish(["project-model", projectId], {
        updatedInstances: [instance],
        deletedInstanceIds: [instanceId],
      })

      void this.projectEvaluationSubsystem.evaluateProject(projectId)

      return instance
    } catch (error) {
      this.logger.error({ error, projectId, instanceId, newName }, "failed to rename instance")
      throw error
    }
  }

  /**
   * Update an instance in the project.
   *
   * @param projectId The ID of the project containing the instance.
   * @param instanceId The ID of the instance to update.
   * @param patch The patch to apply to the instance.
   */
  async updateInstance(
    projectId: string,
    instanceId: InstanceId,
    patch: InstanceModelPatch,
  ): Promise<InstanceModel> {
    try {
      const { project, backend, spec } = await this.getProjectWithBackend(projectId)
      try {
        const instance = await backend.updateInstance(project, spec, instanceId, patch)
        const library = await this.libraryBackend.loadLibrary(project.libraryId)

        await this.pubsubManager.publish(["project-model", projectId], {
          updatedInstances: [instance],
        })

        if (!isUnitModel(library.components[instance.type]) && patch.args) {
          // evaluate the project if arguments changed for composite instancer
          void this.projectEvaluationSubsystem.evaluateProject(projectId)
        } else if (patch.hubInputs || patch.injectionInputs || patch.inputs) {
          // TODO: only evaluate if inputs changed for composite instances
          void this.projectEvaluationSubsystem.evaluateProject(projectId)
        }

        return instance
      } catch (error) {
        const cause =
          error instanceof ProjectModelError && error.cause instanceof Error ? error.cause : error

        if (cause instanceof ProjectModelInstanceNotFoundError) {
          const instance = await this.updateGhostInstanceModel(projectId, instanceId, patch)

          await this.pubsubManager.publish(["project-model", projectId], {
            updatedGhostInstances: [instance],
          })

          return instance
        }

        throw error
      }
    } catch (error) {
      this.logger.error({ error, projectId, instanceId }, "failed to update instance")
      throw error
    }
  }

  /**
   * Delete an instance from the project.
   *
   * @param projectId The ID of the project containing the instance.
   * @param instanceId The ID of the instance to delete.
   */
  async deleteInstance(projectId: string, instanceId: InstanceId): Promise<void> {
    try {
      const { project, backend, spec } = await this.getProjectWithBackend(projectId)
      await backend.deleteInstance(project, spec, instanceId)

      await this.pubsubManager.publish(["project-model", projectId], {
        deletedInstanceIds: [instanceId],
      })

      void this.projectEvaluationSubsystem.evaluateProject(projectId)
    } catch (error) {
      this.logger.error({ error, projectId, instanceId }, "failed to delete instance")
      throw error
    }
  }

  private async updateGhostInstanceModel(
    projectId: string,
    instanceId: InstanceId,
    patch: InstanceModelPatch,
  ): Promise<InstanceModel> {
    const database = await this.database.forProject(projectId)

    const state = await database.instanceState.findUnique({
      where: { instanceId },
      select: { id: true, model: true },
    })

    if (!state?.model) {
      throw new ProjectModelInstanceNotFoundError(projectId, instanceId)
    }

    const instance = instanceModelSchema.parse(state.model)

    applyInstancePatch(instance, patch)

    await database.instanceState.update({
      where: { id: state.id },
      data: { model: instance as InputJsonValue },
    })

    this.logger.info({ projectId, instanceId }, "updated ghost instance model")

    return instance
  }

  /**
   * Update a hub in the project.
   *
   * @param projectId The ID of the project containing the hub.
   * @param hubId The ID of the hub to update.
   * @param patch The patch to apply to the hub.
   */
  async updateHub(projectId: string, hubId: string, patch: HubModelPatch): Promise<HubModel> {
    try {
      const { project, backend, spec } = await this.getProjectWithBackend(projectId)
      const hub = await backend.updateHub(project, spec, hubId, patch)

      await this.pubsubManager.publish(["project-model", projectId], {
        updatedHubs: [hub],
      })

      if (patch.inputs || patch.injectionInputs) {
        void this.projectEvaluationSubsystem.evaluateProject(projectId)
      }

      return hub
    } catch (error) {
      this.logger.error({ error, projectId, hubId }, "failed to update hub")
      throw error
    }
  }

  /**
   * Delete a hub from the project.
   *
   * @param projectId The ID of the project containing the hub.
   * @param hubId The ID of the hub to delete.
   */
  async deleteHub(projectId: string, hubId: string): Promise<void> {
    try {
      const { project, backend, spec } = await this.getProjectWithBackend(projectId)
      await backend.deleteHub(project, spec, hubId)

      await this.pubsubManager.publish(["project-model", projectId], {
        deletedHubIds: [hubId],
      })

      void this.projectEvaluationSubsystem.evaluateProject(projectId)
    } catch (error) {
      this.logger.error({ error, projectId, hubId }, "failed to delete hub")
      throw error
    }
  }

  /**
   * Create multiple instances and hubs atomically from a blueprint.
   *
   * @param projectId The ID of the project to create the nodes in.
   * @param instances The instances to create.
   * @param hubs The hubs to create.
   */
  async createNodes(
    projectId: string,
    instances: InstanceModel[],
    hubs: HubModel[],
  ): Promise<void> {
    try {
      const database = await this.database.forProject(projectId)

      const states = await database.$transaction(async tx => {
        const { project, backend, spec } = await this.getProjectWithBackend(projectId)
        await backend.createNodes(project, spec, instances, hubs)

        // ensure instance states exist for created instances
        return await Promise.all(
          instances.map(async instance => {
            const result = await tx.instanceState.upsert({
              where: { instanceId: instance.id },
              create: {
                instanceId: instance.id,
                kind: instance.kind,
                source: "resident",
                status: "undeployed",
              },
              update: {
                // turn any virtual instance into resident
                // the next evaluation will throw an error indicating the instance is now duplicate and will no longer produce this virtual instance
                source: "resident",
              },
              // in case we restoring instance for existing state, to stream it correctly
              include: includeForInstanceState({
                includeEvaluationState: true,
                includeExtra: true,
                includeLastOperationState: true,
                loadCustomStatuses: true,
              }),
            })

            return mapInstanceStateResult(result)
          }),
        )
      })

      void this.pubsubManager.publish(["project-model", projectId], {
        updatedHubs: hubs,
        updatedInstances: instances,
      })

      for (const state of states) {
        void this.pubsubManager.publish(["instance-state", projectId], { type: "updated", state })
      }

      void this.projectEvaluationSubsystem.evaluateProject(projectId)
    } catch (error) {
      this.logger.error(
        { error, projectId, instanceCount: instances.length, hubCount: hubs.length },
        "failed to create many nodes",
      )
      throw error
    }
  }

  /**
   * Get the project, backend, and storage spec in a single optimized SQL call.
   *
   * @param projectId The ID of the project.
   * @returns Object containing project, backend, and spec.
   */
  private async getProjectWithBackend(projectId: string): Promise<{
    project: ProjectOutput
    backend: ProjectModelBackend
    spec: ProjectModelStorageSpec
  }> {
    const result = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: {
        ...forSchema(projectOutputSchema),
        modelStorage: {
          select: {
            spec: true,
          },
        },
      },
    })

    if (!result) {
      throw new ProjectNotFoundError(projectId)
    }

    const { modelStorage, ...project } = result
    const spec = modelStorage.spec
    const backend = this.getProjectModelBackend(spec.type)

    return { project, backend, spec }
  }

  /**
   * Get the appropriate project model backend for the given project.
   *
   * @param project The project to get the backend for.
   * @returns The project model backend.
   */
  private getProjectModelBackend(type: string): ProjectModelBackend {
    const backend = this.projectModelBackends[type]
    if (!backend) {
      throw new Error(`Project model backend not found for type: ${type}`)
    }
    return backend
  }
}
