import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { Logger } from "pino"
import type { LibraryBackend } from "../library"
import type { PubSubManager } from "../pubsub"
import type { RuntimeEvaluationBackend } from "../runner"
import type { LibraryService } from "./library"
import type { ObjectRefIndexService } from "./object-ref-index"
import type { ProjectLibraryService } from "./project-library"
import type { ProjectModelService } from "./project-model"
import type { ProjectUnlockService } from "./project-unlock"
import { randomUUID } from "node:crypto"
import { isNonNullish } from "remeda"
import { renderTree, type TreeNode } from "../common"
import {
  type DatabaseManager,
  DbNull,
  type InstanceEvaluationStateUncheckedCreateInput,
  type InstanceEvaluationStateUpdateInput,
  type InstanceStatus,
  withProjectReadTransaction,
} from "../database"
import { modelRevision } from "../orchestrator/revisions"
import { stableJsonStringify } from "../shared"

type EvaluationFence = {
  librarySnapshotId: string | null
  modelRevision: string
  localOverlayRevision: string | null
  evaluationActionId: string
}

class StaleEvaluationError extends Error {}

type EvaluatedInstance = {
  instanceId: InstanceId
  status: "evaluated" | "error"
  message?: string
  model?: InstanceModel | null
  kind?: InstanceModel["kind"]
}

export class ProjectEvaluationSubsystem {
  private readonly projectWatchers = new Map<string, AbortController>()
  private readonly evaluationPromises = new Map<string, Promise<void>>()
  private readonly evaluationRequested = new Set<string>()

  constructor(
    private readonly database: DatabaseManager,
    private readonly libraryBackend: LibraryBackend,
    private readonly libraryService: LibraryService,
    private readonly projectModelService: ProjectModelService,
    private readonly pubsubManager: PubSubManager,
    private readonly projectUnlockService: ProjectUnlockService,
    private readonly objectRefIndexService: ObjectRefIndexService,
    private readonly logger: Logger,
    private readonly runtimeEvaluation?: RuntimeEvaluationBackend,
    private readonly projectLibrary?: ProjectLibraryService,
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
    const existingPromise = this.evaluationPromises.get(projectId)
    if (existingPromise) {
      this.evaluationRequested.add(projectId)
      await existingPromise
      return
    }

    const promise = this.evaluateProjectLoop(projectId).finally(() => {
      this.evaluationPromises.delete(projectId)
      this.evaluationRequested.delete(projectId)
    })

    this.evaluationPromises.set(projectId, promise)
    await promise
  }

  private async evaluateProjectLoop(projectId: string): Promise<void> {
    do {
      this.evaluationRequested.delete(projectId)
      try {
        await this.evaluateProjectNow(projectId)
      } catch (error) {
        if (!(error instanceof StaleEvaluationError)) throw error
        this.evaluationRequested.add(projectId)
      }
    } while (this.evaluationRequested.has(projectId))
  }

  private async evaluateProjectNow(projectId: string): Promise<void> {
    const catalog = await this.projectLibrary?.catalog(projectId)
    const { project, instances, resolvedInputs } = structuredClone(
      await this.projectModelService.resolveProject(projectId),
    )

    const instancesMap = new Map<string, InstanceModel>()

    for (const instance of instances) {
      instancesMap.set(instance.id, instance)
    }

    const compositeInstanceIds = instances
      .filter(instance => instance.kind === "composite")
      .map(instance => instance.id)

    const fence: EvaluationFence = {
      librarySnapshotId: catalog?.snapshotId ?? null,
      modelRevision: modelRevision({ instances, resolvedInputs }),
      localOverlayRevision: catalog?.overlay.revision ?? null,
      evaluationActionId: this.runtimeEvaluation ? "" : `local:${randomUUID()}`,
    }
    const isCurrent = async () => {
      const current = await this.projectModelService.resolveProject(projectId)
      const currentCatalog = await this.projectLibrary?.catalog(projectId)
      return (
        modelRevision({ instances: current.instances, resolvedInputs: current.resolvedInputs }) ===
          fence.modelRevision &&
        (currentCatalog?.snapshotId ?? null) === fence.librarySnapshotId &&
        (currentCatalog?.overlay.revision ?? null) === fence.localOverlayRevision
      )
    }
    const residentInstanceIds = new Set(instances.map(instance => instance.id))

    try {
      const virtualComponents = await this.libraryService.getVirtualComponentsCore(project.id)
      if (!(await isCurrent())) throw new StaleEvaluationError()
      if (
        (this.projectLibrary || this.runtimeEvaluation) &&
        (!this.runtimeEvaluation || !fence.librarySnapshotId)
      ) {
        throw new Error("Snapshot evaluation requires a resolved snapshot and runtime evaluator")
      }
      const runtimeResult = this.runtimeEvaluation
        ? await this.runtimeEvaluation.evaluate(
            {
              projectId,
              librarySnapshotId: fence.librarySnapshotId!,
              modelRevision: fence.modelRevision,
              localOverlayRevision: fence.localOverlayRevision,
              instances,
              resolvedInputs,
              virtualComponents,
            },
            new AbortController().signal,
          )
        : undefined
      if (runtimeResult) {
        if (!runtimeResult.actionId)
          throw new Error("Runtime evaluation returned no action identity")
        fence.evaluationActionId = runtimeResult.actionId
      }
      const result =
        runtimeResult?.result ??
        (await this.libraryBackend.evaluateCompositeInstances(
          "local",
          virtualComponents,
          instances,
          resolvedInputs,
        ))

      if (!(await isCurrent())) throw new StaleEvaluationError()
      if (result.success) {
        const ids = new Set<string>()
        for (const instance of result.virtualInstances) {
          if (
            ids.has(instance.id) ||
            (instancesMap.has(instance.id) && instancesMap.get(instance.id)?.kind !== "composite")
          )
            throw new Error(`Duplicate evaluated instance "${instance.id}"`)
          ids.add(instance.id)
        }
      }

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

        // completion markers also fence composites which generate no children after a restart
        for (const instanceId of compositeInstanceIds) {
          if (!evaluatedInstances.some(instance => instance.instanceId === instanceId)) {
            evaluatedInstances.push({
              instanceId,
              status: "evaluated",
              model: null,
              kind: "composite",
            })
          }
        }

        const errorEvaluatedInstances: EvaluatedInstance[] = Object.entries(
          result.topLevelErrors,
        ).map(([instanceId, message]) => ({
          instanceId: instanceId as InstanceId,
          status: "error",
          message,
          model: null,
          kind: instancesMap.get(instanceId)?.kind,
        }))

        await this.setInstanceEvaluationStates(
          project.id,
          ProjectEvaluationSubsystem.mergeEvaluatedInstances(
            evaluatedInstances,
            errorEvaluatedInstances,
          ),
          { fence, isCurrent, residentInstanceIds },
        )
      } else {
        // set all composite instances to error state in evaluation
        const errorEvaluationStates: EvaluatedInstance[] = compositeInstanceIds.map(instanceId => ({
          instanceId: instanceId as InstanceId,
          status: "error",
          message: result.error,
          model: instancesMap.get(instanceId) ?? null,
        }))

        await this.setInstanceEvaluationStates(project.id, errorEvaluationStates, {
          preserveMissingVirtualEvaluationStates: true,
          fence,
          isCurrent,
          residentInstanceIds,
        })
      }

      this.logger.info(
        { projectId: project.id, compositeInstanceIds },
        "composite instances evaluation completed",
      )
    } catch (error) {
      if (error instanceof StaleEvaluationError || !(await isCurrent())) {
        this.evaluationRequested.add(projectId)
        return
      }
      this.logger.error({ projectId: project.id, error }, "failed to evaluate project")
      if (error instanceof Error && "actionId" in error && typeof error.actionId === "string") {
        fence.evaluationActionId = error.actionId
      }
      if (!fence.evaluationActionId) throw error

      // set all composite instances to internal error state
      const internalErrorStates: EvaluatedInstance[] = compositeInstanceIds.map(instanceId => ({
        instanceId: instanceId as InstanceId,
        status: "error",
        message: "Internal error occurred during evaluation.",
        model: instancesMap.get(instanceId) ?? null,
      }))

      await this.setInstanceEvaluationStates(project.id, internalErrorStates, {
        preserveMissingVirtualEvaluationStates: true,
        fence,
        isCurrent,
        residentInstanceIds,
      })
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
    options: {
      preserveMissingVirtualEvaluationStates?: boolean
      fence: EvaluationFence
      isCurrent: () => Promise<boolean>
      residentInstanceIds: Set<string>
    },
  ): Promise<void> {
    const database = await this.database.forProject(projectId)
    if (!(await options.isCurrent())) throw new StaleEvaluationError()

    const outcome = await database.$transaction(async tx => {
      if (!(await withProjectReadTransaction(projectId, tx, options.isCurrent)))
        throw new StaleEvaluationError()
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
            kind: instance.kind ?? instance.model?.kind ?? "unit",
            source: options.residentInstanceIds.has(instance.instanceId) ? "resident" : "virtual",
            status: "undeployed",
          },
          update: {
            source: options.residentInstanceIds.has(instance.instanceId) ? "resident" : "virtual",
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
          ...options.fence,
        }
      })

      // 3. persist the evaluation states
      const existingStates = await tx.instanceEvaluationState.findMany({
        select: {
          stateId: true,
          status: true,
          message: true,
          model: true,
          librarySnapshotId: true,
          modelRevision: true,
          localOverlayRevision: true,
          evaluationActionId: true,
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
      const existingStateById = new Map(existingStates.map(state => [state.stateId, state]))

      const newStates = states.filter(state => !existingStateIds.has(state.stateId))

      const statesToUpdate = states.filter(state => {
        const existingState = existingStateById.get(state.stateId)
        if (!existingState) {
          return false
        }

        return (
          existingState.status !== state.status ||
          (existingState.message ?? null) !== (state.message ?? null) ||
          stableJsonStringify(existingState.model) !== stableJsonStringify(state.model) ||
          existingState.librarySnapshotId !== state.librarySnapshotId ||
          existingState.modelRevision !== state.modelRevision ||
          existingState.localOverlayRevision !== state.localOverlayRevision ||
          existingState.evaluationActionId !== state.evaluationActionId
        )
      })

      const statesToDelete = existingStates.filter(state => {
        if (actualStateIds.has(state.stateId)) {
          return false
        }

        if (options?.preserveMissingVirtualEvaluationStates && state.state.source === "virtual") {
          return false
        }

        return true
      })

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

      const updatedVirtualInstances = [...newStates, ...updatedStates]
        .filter(state => state.model !== DbNull)
        .map(state => state.model as InstanceModel)
        .filter(isNonNullish)
      const deletedVirtualInstanceIds = statesToDelete
        .filter(state => state.state.source === "virtual")
        .map(state => state.state.instanceId)
      const updatedGhostInstances = newGhostInstances.filter(isNonNullish)

      if (!(await withProjectReadTransaction(projectId, tx, options.isCurrent)))
        throw new StaleEvaluationError()
      return {
        stateIds: Array.from(instanceIdToStateMap.values()).map(state => state.id),
        updatedStates,
        deletedStateIds: statesToDelete.map(state => state.stateId),
        modelUpdate: {
          updatedVirtualInstances,
          deletedVirtualInstanceIds,
          updatedGhostInstances,
          deletedGhostInstanceIds: resolvedGhostInstanceIds,
        },
      }
    })

    if (!(await options.isCurrent())) throw new StaleEvaluationError()
    if (outcome.updatedStates.length > 0 || outcome.deletedStateIds.length > 0) {
      void this.pubsubManager.publish(["instance-state", projectId], {
        type: "patched-batch",
        patches: [
          ...outcome.updatedStates.map(state => ({
            stateId: state.stateId,
            patch: { evaluationState: state },
          })),
          ...outcome.deletedStateIds.map(stateId => ({
            stateId,
            patch: { evaluationState: null },
          })),
        ],
      })
    }
    if (Object.values(outcome.modelUpdate).some(values => values.length > 0)) {
      void this.pubsubManager.publish(["project-model", projectId], outcome.modelUpdate)
    }
    if (outcome.stateIds.length > 0) {
      await this.objectRefIndexService.track(projectId, outcome.stateIds)
    }
  }

  private async trackUnlockedProject(projectId: string): Promise<void> {
    if (this.projectWatchers.has(projectId)) {
      this.logger.debug({ projectId }, "project already being tracked, skipping")
      return
    }

    try {
      const project = await this.database.backend.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      })

      if (!project) {
        this.logger.warn({ projectId }, "project not found, cannot track")
        return
      }

      const controller = new AbortController()

      this.projectWatchers.set(projectId, controller)
      this.logger.debug({ projectId }, "tracking unlocked project for library reload evaluations")

      void this.startProjectLibraryWatcher(projectId, "local", controller.signal)
    } catch (error) {
      this.logger.error({ projectId, error }, "failed to start tracking project")
    }
  }

  private async startProjectLibraryWatcher(
    projectId: string,
    libraryId: string | undefined,
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

  private static mergeEvaluatedInstances(
    evaluatedInstances: EvaluatedInstance[],
    errorEvaluatedInstances: EvaluatedInstance[],
  ): EvaluatedInstance[] {
    const merged = new Map<InstanceId, EvaluatedInstance>()

    for (const state of evaluatedInstances) {
      merged.set(state.instanceId, state)
    }

    for (const state of errorEvaluatedInstances) {
      merged.set(state.instanceId, state)
    }

    return Array.from(merged.values())
  }
}
