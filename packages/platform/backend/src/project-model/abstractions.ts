import type {
  HubModel,
  HubModelPatch,
  InstanceModel,
  InstanceModelPatch,
} from "@highstate/contract"
import type { ProjectModel, ProjectModelStorageSpec, ProjectOutput } from "../shared"

/**
 * Interface for project model backends that handle storage-specific operations.
 */
export interface ProjectModelBackend {
  /**
   * Get the instances and hubs of the project.
   *
   * @param project The project to get the model for.
   * @param spec The project model storage specification.
   * @param signal Optional abort signal.
   */
  getProjectModel(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    signal?: AbortSignal,
  ): Promise<ProjectModel>

  /**
   * Create an empty project model.
   *
   * @param project The project to create the model for.
   * @param spec The project model storage specification.
   */
  createProjectModel(project: ProjectOutput, spec: ProjectModelStorageSpec): Promise<void>

  /**
   * Creates a set of instances and hubs from the blueprint.
   * All changes are atomic.
   *
   * @param project The project to create the nodes in.
   * @param spec The project model storage specification.
   * @param instances The instances to apply from the blueprint.
   * @param hubs The hubs to apply from the blueprint.
   */
  createNodes(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instances: InstanceModel[],
    hubs: HubModel[],
  ): Promise<void>

  /**
   * Rename the instance of the project.
   * Changes its id and updates all references to the instance.
   * Potentially dangerous, but safe when the instance is not yet created.
   *
   * @param project The project containing the instance.
   * @param spec The project model storage specification.
   * @param instanceId The ID of the instance to rename.
   * @param newName The new name for the instance.
   */
  renameInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
    newName: string,
  ): Promise<InstanceModel>

  /**
   * Patches the instance of the project.
   *
   * @param project The project containing the instance.
   * @param spec The project model storage specification.
   * @param instanceId The ID of the instance to update.
   * @param patch The patch to apply to the instance.
   */
  updateInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
    patch: InstanceModelPatch,
  ): Promise<InstanceModel>

  /**
   * Delete the instance of the project.
   *
   * @param project The project containing the instance.
   * @param spec The project model storage specification.
   * @param instanceId The ID of the instance to delete.
   */
  deleteInstance(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    instanceId: string,
  ): Promise<void>

  /**
   * Patches the hub of the project.
   *
   * @param project The project containing the hub.
   * @param spec The project model storage specification.
   * @param hubId The ID of the hub to update.
   * @param patch The patch to apply to the hub.
   */
  updateHub(
    project: ProjectOutput,
    spec: ProjectModelStorageSpec,
    hubId: string,
    patch: HubModelPatch,
  ): Promise<HubModel>

  /**
   * Delete the hub of the project.
   *
   * @param project The project containing the hub.
   * @param spec The project model storage specification.
   * @param hubId The ID of the hub to delete.
   */
  deleteHub(project: ProjectOutput, spec: ProjectModelStorageSpec, hubId: string): Promise<void>
}
