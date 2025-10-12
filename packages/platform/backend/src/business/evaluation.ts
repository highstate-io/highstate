import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { Logger } from "pino"
import type { LibraryBackend } from "../library"
import type { PubSubManager } from "../pubsub"
import type { ProjectModelService } from "./project-model"
import type { ProjectUnlockService } from "./project-unlock"
import { isNonNullish } from "remeda"
import { renderTree, type TreeNode } from "../common"
import {
  type DatabaseManager,
  DbNull,
  type InstanceEvaluationStateUncheckedCreateInput,
  type InstanceEvaluationStateUpdateInput,
  type InstanceStatus,
} from "../database"

type EvaluatedInstance = {
  instanceId: InstanceId
  status: "evaluated" | "error"
  message?: string
  model?: InstanceModel | null
}

export class ProjectEvaluationSubsystem {
  private readonly projectWatchers = new Map<string, AbortController>()

  constructor(
    private readonly database: DatabaseManager,
    private readonly libraryBackend: LibraryBackend,
    private readonly projectModelService: ProjectModelService,
    private readonly pubsubManager: PubSubManager,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly logger: Logger,
  ) {
    this.projectUnlockService.registerUnlockTask(
      "evaluate-project",
      //
      projectId => this.evaluateProject(projectId),
    )

    this.projectUnlockService.registerUnlockTask(
      //
      "track-unlocked-project",
      projectId => this.trackUnlockedProject(projectId),
    )
  }

  async evaluateProject(projectId: string): Promise<void> {
    const { project, instances, resolvedInputs } =
      await this.projectModelService.resolveProject(projectId)

    const instancesMap = new Map<string, InstanceModel>()
    for (const instance of instances) {
      instancesMap.set(instance.id, instance)
    }

    const compositeInstanceIds = instances
      .filter(instance => instance.kind === "composite")
      .map(instance => instance.id)

    try {
      const result = await this.libraryBackend.evaluateCompositeInstances(
        project.libraryId,
        instances,
        resolvedInputs,
      )

      if (result.success) {
        // create evaluation tree for success messages
        const treeNodes = ProjectEvaluationSubsystem.createEvaluatedInstanceTree(
          result.virtualInstances,
        )

        // store evaluation states for virtual instances
        const evaluatedInstances: EvaluatedInstance[] = result.virtualInstances.map(instance => ({
          instanceId: instance.id as InstanceId,
          status: "evaluated",
          message: ProjectEvaluationSubsystem.renderEvaluationMessage(treeNodes, instance.id),
          model: instance,
        }))

        const errorEvaluatedInstances: EvaluatedInstance[] = Object.entries(
          result.topLevelErrors,
        ).map(([instanceId, message]) => ({
          instanceId: instanceId as InstanceId,
          status: "error",
          message,
          model: null,
        }))

        await this.setInstanceEvaluationStates(project.id, [
          ...evaluatedInstances,
          ...errorEvaluatedInstances,
        ])
      } else {
        // set all composite instances to error state in evaluation
        const errorEvaluationStates: EvaluatedInstance[] = compositeInstanceIds.map(instanceId => ({
          instanceId: instanceId as InstanceId,
          status: "error",
          message: result.error,
          model: instancesMap.get(instanceId) ?? null,
        }))

        await this.setInstanceEvaluationStates(project.id, errorEvaluationStates)
      }

      this.logger.info(
        { projectId: project.id, compositeInstanceIds },
        "composite instances evaluation completed",
      )
    } catch (error) {
      this.logger.error({ projectId: project.id, error }, "failed to evaluate project")

      // set all composite instances to internal error state
      const internalErrorStates: EvaluatedInstance[] = compositeInstanceIds.map(instanceId => ({
        instanceId: instanceId as InstanceId,
        status: "error",
        message: "Internal error occurred during evaluation.",
        model: instancesMap.get(instanceId) ?? null,
      }))

      await this.setInstanceEvaluationStates(project.id, internalErrorStates)
    }
  }

  /**
   * Sets the evaluation states for multiple instances in a project.
   *
   * @param projectId The ID of the project to update.
   * @param evaluatedInstances The evaluation states to set.
   */
  private async setInstanceEvaluationStates(
    projectId: string,
    evaluatedInstances: EvaluatedInstance[],
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    await database.$transaction(async tx => {
      const previousVirtualStates = await tx.instanceState.findMany({
        where: { source: "virtual" },
        select: {
          id: true,
          instanceId: true,
          status: true,
          model: true,
          evaluationState: { select: { stateId: true } },
        },
      })

      // 1. resolve instanceId -> stateId for all evaluated instances
      // also ensure that all states exist and has "virtual" source
      const instanceIdToStateMap = new Map<
        string,
        { id: string; status: InstanceStatus; model: InstanceModel | null }
      >()

      for (const instance of evaluatedInstances) {
        const state = await tx.instanceState.upsert({
          select: { id: true, status: true, model: true },
          where: { instanceId: instance.instanceId },
          create: {
            instanceId: instance.instanceId,
            kind: instance.model?.kind ?? "unit",
            source: "virtual",
            status: "undeployed",
          },
          update: {
            source: "virtual",
          },
        })

        instanceIdToStateMap.set(instance.instanceId, state)
      }

      // 2. convert EvaluatedInstance[] to InstanceEvaluationStateUncheckedCreateInput[]
      const states: InstanceEvaluationStateUncheckedCreateInput[] = evaluatedInstances.map(ei => {
        return {
          stateId: instanceIdToStateMap.get(ei.instanceId)!.id,
          status: ei.status,
          message: ei.message,
          model: ei.model ?? DbNull,
        }
      })

      // 3. persist the evaluation states
      const existingStates = await tx.instanceEvaluationState.findMany({
        select: {
          stateId: true,
          state: {
            select: {
              instanceId: true,
              source: true,
            },
          },
        },
      })

      const existingStateIds = new Set(existingStates.map(state => state.stateId))
      const actualStateIds = new Set(states.map(state => state.stateId))

      const newStates = states.filter(state => !existingStateIds.has(state.stateId))
      const statesToUpdate = states.filter(state => existingStateIds.has(state.stateId))
      const statesToDelete = existingStates.filter(state => !actualStateIds.has(state.stateId))

      // create new states
      await tx.instanceEvaluationState.createMany({ data: newStates })

      // update existing states
      const updatedStates = await Promise.all(
        statesToUpdate.map(state =>
          tx.instanceEvaluationState.update({
            where: { stateId: state.stateId },
            data: state as InstanceEvaluationStateUpdateInput,
          }),
        ),
      )

      // delete states that are no longer present
      await tx.instanceEvaluationState.deleteMany({
        where: {
          stateId: {
            in: statesToDelete.map(state => state.stateId),
          },
        },
      })

      // 5. publish evaluation state updates
      for (const state of updatedStates) {
        void this.pubsubManager.publish(["instance-state", projectId], {
          type: "patched",
          stateId: state.stateId,
          patch: {
            evaluationState: state,
          },
        })
      }

      const currentVirtualStates = await tx.instanceState.findMany({
        where: { source: "virtual" },
        select: {
          id: true,
          instanceId: true,
          status: true,
          model: true,
          evaluationState: { select: { stateId: true } },
        },
      })

      const previousGhostStates = new Map(
        previousVirtualStates
          .filter(state => state.status !== "undeployed" && !state.evaluationState)
          .map(state => [state.id, state]),
      )

      const currentGhostStates = new Map(
        currentVirtualStates
          .filter(state => state.status !== "undeployed" && !state.evaluationState)
          .map(state => [state.id, state]),
      )

      const newGhostInstances: InstanceModel[] = []
      for (const [stateId, state] of currentGhostStates) {
        if (previousGhostStates.has(stateId)) {
          continue
        }

        if (state.model) {
          newGhostInstances.push(state.model as InstanceModel)
        }
      }

      const resolvedGhostInstanceIds: InstanceId[] = []
      for (const [stateId, state] of previousGhostStates) {
        if (!currentGhostStates.has(stateId)) {
          resolvedGhostInstanceIds.push(state.instanceId as InstanceId)
        }
      }

      // 6. publish project model update
      void this.pubsubManager.publish(["project-model", projectId], {
        updatedVirtualInstances: [...newStates, ...updatedStates]
          .map(state => state.model as InstanceModel)
          .filter(isNonNullish),

        deletedVirtualInstanceIds: statesToDelete.map(state => state.state.instanceId),

        updatedGhostInstances: newGhostInstances.filter(isNonNullish),

        deletedGhostInstanceIds: resolvedGhostInstanceIds,
      })
    })
  }

  private async trackUnlockedProject(projectId: string): Promise<void> {
    if (this.projectWatchers.has(projectId)) {
      this.logger.debug({ projectId }, "project already being tracked, skipping")
      return
    }

    try {
      const project = await this.database.backend.project.findUnique({
        where: { id: projectId },
        select: { id: true, libraryId: true },
      })

      if (!project) {
        this.logger.warn({ projectId }, "project not found, cannot track")
        return
      }

      const controller = new AbortController()

      this.projectWatchers.set(projectId, controller)
      this.logger.debug(
        { projectId, libraryId: project.libraryId },
        "tracking unlocked project for library reload evaluations",
      )

      void this.startProjectLibraryWatcher(projectId, project.libraryId, controller.signal)
    } catch (error) {
      this.logger.error({ projectId, error }, "failed to start tracking project")
    }
  }

  private async startProjectLibraryWatcher(
    projectId: string,
    libraryId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      for await (const updates of this.libraryBackend.watchLibrary(libraryId, signal)) {
        // only handle reload-completed events
        if (updates.some(update => update.type === "reload-completed")) {
          await this.handleProjectLibraryReload(projectId)
        }
      }
    } catch (error) {
      this.logger.error({ projectId, libraryId, error }, "project library reload watcher failed")
    } finally {
      this.projectWatchers.delete(projectId)
    }
  }

  private async handleProjectLibraryReload(projectId: string): Promise<void> {
    this.logger.info({ projectId }, "launching evaluation for project after library reload")

    try {
      await this.evaluateProject(projectId)
    } catch (error) {
      this.logger.error({ projectId, error }, "failed to evaluate project after library reload")
    }
  }

  static createEvaluatedInstanceTree(virtualInstances: InstanceModel[]): Map<string, TreeNode> {
    const treeNodes = new Map<string, TreeNode>()

    for (const instance of virtualInstances) {
      const node: TreeNode = {
        text: instance.id,
        children: [],
      }

      treeNodes.set(instance.id, node)

      const parentNode = instance.parentId ? treeNodes.get(instance.parentId) : undefined

      if (parentNode) {
        parentNode.children.push(node)
      }
    }

    return treeNodes
  }

  static renderEvaluationMessage(treeNodes: Map<string, TreeNode>, rootNodeId: string): string {
    // get the root node
    const rootNode = treeNodes.get(rootNodeId)
    if (!rootNode) {
      return `Composite instance evaluation completed successfully, but failed to build the tree structure.`
    }

    // render the tree structure
    const tree = renderTree(rootNode)

    return `Composite instance evaluation completed successfully.\n\nInstance Tree:\n${tree}`
  }
}
