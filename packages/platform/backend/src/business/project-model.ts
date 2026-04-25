import type { InstanceInput, InstanceModel } from "@highstate/contract"
import type { Logger } from "pino"
import type { DatabaseManager } from "../database"
import type { LibraryBackend } from "../library"
import type { ProjectModelBackend } from "../project-model"
import type { InstanceStateService } from "./instance-state"
import type { ProjectUnlockService } from "./project-unlock"
import { isNonNullish } from "remeda"
import {
  type FullProjectModel,
  forSchema,
  InputResolver,
  type InputResolverNode,
  ProjectNotFoundError,
  type ProjectOutput,
  projectOutputSchema,
  type ResolvedInstanceInput,
} from "../shared"

export type GetProjectModelOptions = {
  /**
   * Whether to include virtual instances in the model.
   *
   * By default, virtual instances are not included.
   */
  includeVirtualInstances?: boolean

  /**
   * Whether to include ghost instances in the model.
   *
   * By default, ghost instances are not included.
   */
  includeGhostInstances?: boolean
}

export class ProjectModelService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly libraryBackend: LibraryBackend,
    private readonly instanceStateService: InstanceStateService,
    private readonly projectModelBackends: Record<string, ProjectModelBackend>,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly logger: Logger,
  ) {
    this.projectUnlockService.registerUnlockTask(
      //
      "repair-instance-inputs",
      projectId => this.repairInstanceInputs(projectId),
    )

    this.projectUnlockService.registerUnlockTask(
      //
      "sync-instance-states",
      projectId => this.syncInstanceStates(projectId),
    )
  }

  /**
   * Get the project model containing instances, hubs + virtual instances and ghost instances if requested.
   *
   * @param projectId The ID of the project to get the model for.
   * @param options Options to control the model retrieval.
   */
  async getProjectModel(
    projectId: string,
    { includeVirtualInstances = false, includeGhostInstances = false }: GetProjectModelOptions = {},
  ): Promise<[projectModel: FullProjectModel, project: ProjectOutput]> {
    const { project, backend, spec } = await this.getProjectWithBackend(projectId)

    const [{ instances, hubs }, library] = await Promise.all([
      backend.getProjectModel(project, spec),
      this.libraryBackend.loadLibrary(project.libraryId),
    ])

    const filteredInstances = this.filterInstancesWithKnownComponents(
      project.id,
      project.libraryId,
      instances,
      library.components,
      "project-model",
    )

    return [
      {
        instances: filteredInstances,
        hubs,
        virtualInstances: includeVirtualInstances ? await this.getVirtualInstances(projectId) : [],
        ghostInstances: includeGhostInstances
          ? await this.getGhostInstances(
              projectId,
              filteredInstances.map(instance => instance.id),
            )
          : [],
      },
      project,
    ]
  }

  /**
   * Resolve a project by loading all dependencies and processing input resolution.
   * Does not load virtual instances.
   *
   * @param projectId The ID of the project to resolve.
   */
  async resolveProject(projectId: string) {
    const [[{ instances, hubs }, project], states] = await Promise.all([
      this.getProjectModel(projectId),
      this.instanceStateService.getInstanceStates(projectId, { includeEvaluationState: true }),
    ])

    const library = await this.libraryBackend.loadLibrary(project.libraryId)

    const stateMap = new Map(states.map(state => [state.id, state]))

    const inputResolverNodes = new Map<string, InputResolverNode>()

    for (const instance of instances) {
      inputResolverNodes.set(`instance:${instance.id}`, {
        kind: "instance",
        instance,
        component: library.components[instance.type]!,
        entities: library.entities,
      })
    }

    for (const hub of hubs) {
      inputResolverNodes.set(`hub:${hub.id}`, { kind: "hub", hub, entities: library.entities })
    }

    const inputResolver = new InputResolver(inputResolverNodes, this.logger)
    inputResolver.addAllNodesToWorkset()

    const resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>> = {}

    await inputResolver.process()

    for (const instance of instances) {
      const output = inputResolver.requireOutput(`instance:${instance.id}`)
      if (output.kind !== "instance") {
        throw new Error("Expected instance node")
      }

      resolvedInputs[instance.id] = output.resolvedInputs
    }

    return {
      project,
      library,
      instances,
      stateMap,
      resolvedInputs,
    }
  }

  private filterInstancesWithKnownComponents(
    projectId: string,
    libraryId: string,
    instances: InstanceModel[],
    components: Record<string, unknown>,
    source: string,
  ): InstanceModel[] {
    const filteredInstances: InstanceModel[] = []

    for (const instance of instances) {
      if (instance.type in components) {
        filteredInstances.push(instance)
        continue
      }

      this.logger.warn(
        {
          projectId,
          libraryId,
          instanceId: instance.id,
          instanceType: instance.type,
          source,
        },
        "ignoring instance because its component is not defined in the library",
      )
    }

    return filteredInstances
  }

  /**
  /**
   * Get the appropriate project model backend for the given project.
   *
   * @param type The project storage type.
   * @returns The project model backend.
   */
  private getProjectModelBackend(type: string): ProjectModelBackend {
    const backend = this.projectModelBackends[type]
    if (!backend) {
      throw new Error(`Project model backend not found for type: ${type}`)
    }

    return backend
  }

  /**
   * Get project with model backend and spec.
   *
   * @param projectId The project ID to get.
   * @returns The project, backend, and spec.
   */
  private async getProjectWithBackend(projectId: string) {
    const project = await this.database.backend.project.findUnique({
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

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    const backend = this.getProjectModelBackend(project.modelStorage.spec.type)

    return {
      project,
      backend,
      spec: project.modelStorage.spec,
    }
  }

  /**
   * Get virtual instances from the database for the given project ID.
   *
   * @param projectId The project ID to get virtual instances for.
   * @returns The list of virtual instances.
   */
  private async getVirtualInstances(projectId: string): Promise<InstanceModel[]> {
    const database = await this.database.forProject(projectId)
    const states = await database.instanceEvaluationState.findMany({ select: { model: true } })

    return states.map(state => state.model).filter(isNonNullish)
  }

  /**
   * Get ghost instances from the database for the given project ID.
   *
   * @param projectId The project ID to get ghost instances for.
   * @param residentInstanceIds The IDs of the instances present in the model.
   * @return The list of ghost instances.
   */
  private async getGhostInstances(
    projectId: string,
    residentInstanceIds: string[],
  ): Promise<InstanceModel[]> {
    const database = await this.database.forProject(projectId)

    const states = await database.instanceState.findMany({
      where: {
        // undeployed instances cannot be considered ghost
        status: { not: "undeployed" },

        OR: [
          // the resident instance is ghost if it is not in the model
          { source: "resident", instanceId: { notIn: residentInstanceIds } },

          // the virtual instance is ghost if it has no evaluation state and is not represented in the model
          {
            source: "virtual",
            evaluationState: null,
            instanceId: { notIn: residentInstanceIds },
          },
        ],
      },
      select: { model: true },
    })

    return states.map(state => state.model).filter(isNonNullish)
  }

  private async syncInstanceStates(projectId: string): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      const [{ instances }] = await this.getProjectModel(projectId)

      const existingStates = await tx.instanceState.findMany({ select: { instanceId: true } })
      const existingStateIds = new Set(existingStates.map(state => state.instanceId))
      const missingInstances = instances.filter(instance => !existingStateIds.has(instance.id))

      if (missingInstances.length === 0) {
        return
      }

      await tx.instanceState.createMany({
        data: missingInstances.map(instance => ({
          instanceId: instance.id,
          kind: instance.kind,
          source: "resident",
          status: "undeployed",
        })),
      })

      this.logger.info({ projectId }, "created missing %s instance states", missingInstances.length)
    })
  }

  private async repairInstanceInputs(projectId: string): Promise<void> {
    const { project, backend, spec } = await this.getProjectWithBackend(projectId)

    const [{ instances, hubs }, library] = await Promise.all([
      backend.getProjectModel(project, spec),
      this.libraryBackend.loadLibrary(project.libraryId),
    ])

    const instanceById = new Map(instances.map(instance => [instance.id, instance]))

    const isValidInstanceInput = (input: InstanceInput): boolean => {
      const target = instanceById.get(input.instanceId)
      if (!target) {
        return false
      }

      const targetComponent = library.components[target.type]
      if (!targetComponent) {
        return false
      }

      return Boolean(targetComponent.outputs?.[input.output])
    }

    let repairedInstances = 0
    let removedInputs = 0
    let repairedHubs = 0
    let removedHubInputs = 0

    for (const instance of instances) {
      const component = library.components[instance.type]
      if (!component || !instance.inputs) {
        continue
      }

      const componentInputNames = new Set(Object.keys(component.inputs ?? {}))
      const nextInputs: Record<string, InstanceInput[]> = Object.fromEntries(
        Object.entries(instance.inputs)
          .filter(([inputName]) => componentInputNames.has(inputName))
          .map(([inputName, inputValues]) => [inputName, inputValues.filter(isValidInstanceInput)])
          .filter(([, inputValues]) => inputValues.length > 0),
      )

      const removed =
        Object.values(instance.inputs).reduce((sum, values) => sum + values.length, 0) -
        Object.values(nextInputs).reduce((sum, values) => sum + values.length, 0)

      if (removed === 0) {
        continue
      }

      await backend.updateInstance(project, spec, instance.id, {
        inputs: nextInputs,
      })

      repairedInstances += 1
      removedInputs += removed
    }

    for (const hub of hubs) {
      const inputs = hub.inputs ?? []
      if (inputs.length === 0) {
        continue
      }

      const nextInputs = inputs.filter(isValidInstanceInput)
      const removed = inputs.length - nextInputs.length
      if (removed === 0) {
        continue
      }

      await backend.updateHub(project, spec, hub.id, {
        inputs: nextInputs,
      })

      repairedHubs += 1
      removedHubInputs += removed
    }

    if (repairedInstances > 0 || repairedHubs > 0) {
      this.logger.warn(
        { projectId },
        "repaired %s instances and %s hubs, removed %s instance inputs and %s hub inputs during unlock",
        repairedInstances,
        repairedHubs,
        removedInputs,
        removedHubInputs,
      )
    }
  }
}
