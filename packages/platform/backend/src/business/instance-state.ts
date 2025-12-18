import type {
  ComponentKind,
  UnitPage,
  UnitTerminal,
  UnitTrigger,
  UnitWorker,
} from "@highstate/contract"
import type { Logger } from "pino"
import type { ArtifactService } from "../artifact"
import type { SecretService, UnitExtraService, WorkerService } from "../business"
import type { PubSubManager } from "../pubsub"
import type { RunnerBackend } from "../runner"
import { type InstanceId, parseInstanceId } from "@highstate/contract"
import { isNonNullish, omit } from "remeda"
import {
  type DatabaseManager,
  DbNull,
  type InstanceOperationStateCreateManyInput,
  type InstanceOperationStateUpdateInput,
  type InstanceStateInclude,
  type InstanceStateUpdateInput,
  type ProjectTransaction,
} from "../database"
import {
  forSchema,
  type InstanceCustomStatusInput,
  InstanceLockedError,
  type InstanceOperationState,
  type InstanceState,
  InstanceStateNotFoundError,
  ProjectNotFoundError,
  projectOutputSchema,
  waitAll,
} from "../shared"

export type GetProjectInstancesOptions = {
  /**
   * Whether to include evaluation states in the result.
   *
   * By default, this is false.
   */
  includeEvaluationState?: boolean

  /**
   * Include last operation state in the result.
   *
   * By default, this is false.
   */
  includeLastOperationState?: boolean

  /**
   * Include the instance ID of the parent instance in the result.
   *
   * By default, this is false.
   */
  includeParentInstanceId?: boolean

  /**
   * Whether to include `terminalIds` and `pageIds` in the result.
   *
   * By default, this is false.
   */
  includeExtra?: boolean

  /**
   * Whether to load custom statuses for each instance.
   *
   * By default, this is false.
   */
  loadCustomStatuses?: boolean
}

export type ForgetInstanceStateOptions = {
  /**
   * Whether to delete terminals and their sessions associated with the instance.
   *
   * If `false`, the terminals will be marked as deleted and no new sessions will be allowed to be created,
   * but existing sessions will remain to provide history and logs.
   *
   * By default, this is false.
   */
  clearTerminalData?: boolean

  /**
   * Whether to delete the secrets associated with the instance.
   *
   * By default, this is false.
   */
  deleteSecrets?: boolean
}

export type InstanceStatePatch = Pick<
  Partial<InstanceState>,
  | "status"
  | "statusFields"
  | "parentId"
  | "lastOperationState"
  | "inputHash"
  | "outputHash"
  | "dependencyOutputHash"
  | "model"
  | "resolvedInputs"
  | "currentResourceCount"
  | "exportedArtifactIds"
>

export type UpdateOperationStateOptions = {
  /**
   * The operation state to update.
   */
  operationState: InstanceOperationStateUpdateInput

  /**
   * Instance state patch to update or function to compute patch from current state.
   */
  instanceState?: InstanceStatePatch

  /**
   * Unit-specific extra data to update.
   */
  unitExtra?: {
    /**
     * Unit pages to update.
     */
    pages: UnitPage[]

    /**
     * Unit terminals to update.
     */
    terminals: UnitTerminal[]

    /**
     * Unit triggers to update.
     */
    triggers: UnitTrigger[]

    /**
     * Unit workers to update.
     */
    workers: UnitWorker[]

    /**
     * Unit secrets to update.
     */
    secrets: Record<string, unknown>

    /**
     * Artifact IDs that should remain linked to the instance.
     *
     * Any existing instance artifacts not listed here will be disconnected.
     */
    artifactIds?: string[]
  }
}

export function includeForInstanceState(
  options: GetProjectInstancesOptions = {},
): InstanceStateInclude {
  return {
    secrets: {
      select: { name: true },
    },

    parent: options.includeParentInstanceId ? { select: { instanceId: true } } : undefined,

    operationStates: options.includeLastOperationState
      ? { take: 1, orderBy: { startedAt: "desc" } }
      : undefined,

    evaluationState: options.includeEvaluationState,

    terminals: options.includeExtra ? { select: { id: true } } : undefined,
    pages: options.includeExtra ? { select: { id: true } } : undefined,

    customStatuses: options.loadCustomStatuses
      ? {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        }
      : undefined,
  }
}

export function mapInstanceStateResult(
  instance: InstanceState & {
    secrets: { name: string | null }[]
    parent?: { instanceId: InstanceId } | null
    operationStates?: InstanceOperationState[]
    terminals?: { id: string }[]
    pages?: { id: string }[]
    customStatuses: InstanceState["customStatuses"]
  },
): InstanceState {
  return {
    ...omit(instance, [
      "secrets",
      "parent",
      "operationStates",
      "terminals",
      "pages",
      "customStatuses",
    ]),

    secretNames: instance.secrets.map(secret => secret.name).filter(isNonNullish),
    parentInstanceId: instance.parent ? (instance.parent?.instanceId ?? null) : undefined,
    lastOperationState: instance.operationStates?.[0],
    evaluationState: instance.evaluationState ?? undefined,
    terminalIds: instance.terminals ? instance.terminals.map(terminal => terminal.id) : undefined,
    pageIds: instance.pages ? instance.pages.map(page => page.id) : undefined,
    customStatuses: instance.customStatuses ?? undefined,
  }
}

export class InstanceStateService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly runnerBackend: RunnerBackend,
    private readonly workerService: WorkerService,
    private readonly artifactService: ArtifactService,
    private readonly unitExtraService: UnitExtraService,
    private readonly secretService: SecretService,
    private readonly logger: Logger,
  ) {}

  /**
   * Gets the aggregates of all instances in the project.
   *
   * @param projectId The ID of the project for which to retrieve instances.
   * @param options Options to customize the retrieval of instances.
   */
  async getInstanceStates(
    projectId: string,
    options: GetProjectInstancesOptions = {},
  ): Promise<InstanceState[]> {
    const database = await this.database.forProject(projectId)

    // load instance states from the database
    const queryResult = await database.instanceState.findMany({
      include: includeForInstanceState(options),
    })

    // aggregate the results from the database
    return queryResult.map(mapInstanceStateResult)
  }

  /**
   * Marks an instance state as deleted and cleans up associated resources.
   *
   * This operation:
   * - only allows deletion of instances with operation state null or "destroyed";
   * - prevents deletion of instances that have active locks;
   * - marks the instance state as "deleted" (never actually removes the record);
   * - handles terminals: deletes data if requested, otherwise marks as "unavailable";
   * - handles secrets: deletes if requested, otherwise ignores them;
   * - deletes artifact references for the instance;
   * - recursively handles child instances using parentId relationship;
   * - performs worker cleanup and synchronization;
   * - performs artifact garbage collection.
   *
   * @param projectId The ID of the project containing the instance.
   * @param instanceId The ID of the instance whose state is to be marked as deleted.
   * @param options Configuration options for terminal and secret handling.
   */
  async forgetInstanceState(
    projectId: string,
    instanceId: InstanceId,
    { deleteSecrets = false, clearTerminalData = false }: ForgetInstanceStateOptions = {},
  ): Promise<void> {
    await this.forgetInstanceStates(projectId, [instanceId], {
      deleteSecrets,
      clearTerminalData,
    })
  }

  /**
   * Forgets states for multiple instances in a single transaction.
   *
   * The transaction ensures the operation is all-or-nothing.
   * Side effects are still performed after commit.
   *
   * @param projectId The ID of the project containing the instances.
   * @param instanceIds The IDs of the instances whose states are to be forgotten.
   * @param options Configuration options for terminal and secret handling.
   */
  async forgetInstanceStates(
    projectId: string,
    instanceIds: InstanceId[],
    { deleteSecrets = false, clearTerminalData = false }: ForgetInstanceStateOptions = {},
  ): Promise<void> {
    if (instanceIds.length === 0) {
      return
    }

    const database = await this.database.forProject(projectId)
    const project = await this.database.backend.project.findUnique({
      where: { id: projectId },
      select: forSchema(projectOutputSchema),
    })

    if (!project) {
      throw new ProjectNotFoundError(projectId)
    }

    const uniqueInstanceIds = Array.from(new Set(instanceIds))

    // collect instances to process cleanup after transaction
    const unitInstancesToCleanup: { id: string; instanceId: InstanceId }[] = []
    const updatedStateIds: string[] = []

    await database.$transaction(async tx => {
      for (const instanceId of uniqueInstanceIds) {
        const state = await tx.instanceState.findUnique({
          where: { instanceId },
          select: {
            id: true,
            kind: true,
            instanceId: true,
            lock: { select: { stateId: true } },
          },
        })

        if (!state) {
          throw new InstanceStateNotFoundError(projectId, instanceId)
        }

        if (state.lock) {
          throw new InstanceLockedError(projectId, instanceId)
        }

        await this.processInstanceDeletion(
          tx,
          projectId,
          state,
          { deleteSecrets, clearTerminalData },
          unitInstancesToCleanup,
          updatedStateIds,
        )
      }
    })

    const uniqueUpdatedStateIds = Array.from(new Set(updatedStateIds))
    const uniqueUnitInstancesToCleanup = Array.from(
      new Map(unitInstancesToCleanup.map(item => [item.id, item])).values(),
    )

    // publish state events for all updated instances
    for (const updatedStateId of uniqueUpdatedStateIds) {
      void this.pubsubManager.publish(["instance-state", projectId], {
        type: "patched",
        stateId: updatedStateId,
        patch: {
          status: "undeployed",
          statusFields: null,
          inputHash: null,
          outputHash: null,
          dependencyOutputHash: null,
          currentResourceCount: null,
          model: null,
          resolvedInputs: null,
          secretNames: deleteSecrets ? [] : undefined,
          terminalIds: clearTerminalData ? [] : undefined,
          pageIds: [],
          customStatuses: [],
          triggerIds: [],
          evaluationState: null,
        },
      })
    }

    // process side effects
    try {
      await waitAll([
        this.workerService.cleanupWorkerUsageAndSync(projectId),
        this.artifactService.collectGarbage(projectId),
        ...uniqueUnitInstancesToCleanup.map(async ({ id, instanceId }) => {
          const [instanceType, instanceName] = parseInstanceId(instanceId)

          await this.runnerBackend.deleteState({
            projectId: project.id,
            stateId: id,
            libraryId: project.libraryId,
            instanceName,
            instanceType,
          })
        }),
      ])
    } catch (error) {
      this.logger.warn(
        { error, projectId, instanceIds: uniqueInstanceIds },
        "failed to perform side effects after forgetting instance state",
      )
    }
  }

  /**
   * Processes the deletion of an instance within a transaction.
   * Handles validation, deletion logic, and recursive child deletion.
   */
  private async processInstanceDeletion(
    tx: ProjectTransaction,
    projectId: string,
    state: { id: string; kind: ComponentKind; instanceId: InstanceId },
    options: ForgetInstanceStateOptions,
    unitInstancesToCleanup: { id: string; instanceId: InstanceId }[],
    updatedStateIds: string[],
  ): Promise<void> {
    const { deleteSecrets = false, clearTerminalData = false } = options

    // always mark instance state as undeployed (never actually delete the record)
    await tx.instanceState.update({
      where: { id: state.id },
      data: {
        status: "undeployed",
        statusFields: DbNull,
        inputHash: null,
        outputHash: null,
        dependencyOutputHash: null,
        currentResourceCount: null,
        model: DbNull,
        resolvedInputs: DbNull,
      },
    })

    // handle terminals
    if (clearTerminalData) {
      await tx.terminal.deleteMany({ where: { stateId: state.id } })
    } else {
      await tx.terminal.updateMany({
        where: { stateId: state.id },
        data: { status: "unavailable" },
      })
    }

    // handle secrets
    if (deleteSecrets) {
      await tx.secret.deleteMany({
        where: { stateId: state.id },
      })
    }

    // delete custom statuses for this instance
    await tx.instanceCustomStatus.deleteMany({
      where: { stateId: state.id },
    })

    // delete other related resources
    await tx.page.deleteMany({ where: { stateId: state.id } })
    await tx.trigger.deleteMany({ where: { stateId: state.id } })

    // remove artifact references for this instance
    await tx.instanceState.update({
      where: { id: state.id },
      data: {
        artifacts: {
          set: [],
        },
      },
    })

    // collect unit instances for Pulumi cleanup (to be done outside transaction)
    if (state.kind === "unit") {
      unitInstancesToCleanup.push({ id: state.id, instanceId: state.instanceId })
    }

    // track this instance as updated
    updatedStateIds.push(state.id)

    this.logger.info({ projectId }, `marked state "%s" as undeployed`, state.id)

    // recursively handle child instances using parentId
    if (state.kind === "composite") {
      const childStates = await tx.instanceState.findMany({
        where: {
          parentId: state.id,
          status: { not: "undeployed" }, // don't process undeployed children
        },
        select: {
          id: true,
          kind: true,
          instanceId: true,
        },
      })

      // recursively delete child states (within the same transaction)
      for (const child of childStates) {
        await this.processInstanceDeletion(
          tx,
          projectId,
          child,
          options,
          unitInstancesToCleanup,
          updatedStateIds,
        )
      }
    }
  }

  public publishGhostInstanceDeletion(projectId: string, instanceIds: Iterable<InstanceId>): void {
    const ids = Array.from(instanceIds)
    if (ids.length === 0) {
      return
    }

    void this.pubsubManager.publish(["project-model", projectId], {
      deletedGhostInstanceIds: ids,
    })
  }

  /**
   * Replaces or adds a custom status for an instance in a project.
   *
   * @param projectId The ID of the project containing the instance.
   * @param serviceAccoundtId The ID of the service account owning the instance.
   * @param stateId The ID of the instance state to update.
   * @param status The custom status to replace or add.
   */
  async updateCustomStatus(
    projectId: string,
    stateId: string,
    serviceAccountId: string,
    status: InstanceCustomStatusInput,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    const customStatuses = await database.$transaction(async tx => {
      await tx.instanceCustomStatus.upsert({
        where: {
          stateId_serviceAccountId_name: {
            stateId,
            serviceAccountId,
            name: status.name,
          },
        },
        create: {
          stateId: stateId,
          serviceAccountId,
          name: status.name,
          meta: status.meta,
          value: status.value,
          message: status.message ?? null,
          order: status.order ?? 50,
        },
        update: {
          meta: status.meta,
          value: status.value,
          message: status.message ?? null,
          order: status.order ?? 50,
        },
      })

      return await tx.instanceCustomStatus.findMany({
        where: { stateId, serviceAccountId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      })
    })

    void this.pubsubManager.publish(["instance-state", projectId], {
      type: "patched",
      stateId,
      patch: { customStatuses },
    })
  }

  /**
   * Removes a custom status from an instance in a project.
   *
   * @param projectId The ID of the project containing the instance.
   * @param stateId The ID of the instance state to update.
   * @param serviceAccountId The ID of the service account owning the instance.
   * @param statusName The name of the custom status to remove.
   */
  async removeCustomStatus(
    projectId: string,
    stateId: string,
    serviceAccountId: string,
    statusName: string,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    const customStatuses = await database.$transaction(async tx => {
      await tx.instanceCustomStatus.deleteMany({
        where: {
          stateId,
          serviceAccountId,
          name: statusName,
        },
      })

      return await tx.instanceCustomStatus.findMany({
        where: { stateId, serviceAccountId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      })
    })

    void this.pubsubManager.publish(["instance-state", projectId], {
      type: "patched",
      stateId,
      patch: { customStatuses },
    })
  }

  /**
   * Creates the provided operation states.
   * Also updates the instance state if provided.
   *
   * @param projectId The ID of the project containing the instances.
   * @param operationStates The tuples of operation state data to create and instance state patch to apply.
   */
  async createOperationStates(
    projectId: string,
    operationStates: [
      opState: InstanceOperationStateCreateManyInput,
      instanceState: InstanceStatePatch,
    ][],
  ): Promise<Partial<InstanceState>[]> {
    const database = await this.database.forProject(projectId)

    const patches = await database.$transaction(async tx => {
      return await Promise.all(
        operationStates.map(async ([opState, instanceState]) => {
          const operationState = await tx.instanceOperationState.create({
            data: opState,
          })

          const state = await tx.instanceState.update({
            where: { id: opState.stateId },
            data: instanceState as InstanceStateUpdateInput,
          })

          return { ...state, lastOperationState: operationState }
        }),
      )
    })

    // publish patches after transaction
    for (const patch of patches) {
      void this.pubsubManager.publish(["instance-state", projectId], {
        type: "patched",
        stateId: patch.id,
        patch,
      })
    }

    return patches
  }

  /**
   * Updates the operation state and instance state for a specific instance.
   *
   * @param projectId The ID of the project containing the instance.
   * @param stateId The ID of the instance state to update.
   * @param operationId The ID of the operation (required if operationState is provided).
   * @param options Update options containing operation state, instance state, and unit-specific data.
   * @return The instance state patch containing the updated operation state and instance state fields.
   */
  async updateOperationState(
    projectId: string,
    stateId: string,
    operationId: string,
    options: UpdateOperationStateOptions,
  ): Promise<Partial<InstanceState>> {
    const { operationState, instanceState, unitExtra } = options
    const database = await this.database.forProject(projectId)

    const result = await database.$transaction(async tx => {
      let unitExtraData = null

      // update operation state
      const updatedOperationState = await tx.instanceOperationState.update({
        where: {
          operationId_stateId: {
            operationId,
            stateId,
          },
        },
        data: operationState,
      })

      const project = await this.database.backend.project.findUnique({
        where: { id: projectId },
        select: { libraryId: true },
      })

      if (!project) {
        throw new ProjectNotFoundError(projectId)
      }

      // update unit-specific data if provided
      if (unitExtra) {
        const [pageIds, terminalIds, triggerIds, secretNames] = await Promise.all([
          this.unitExtraService.processUnitPages(tx, stateId, unitExtra.pages),
          this.unitExtraService.processUnitTerminals(tx, stateId, unitExtra.terminals),
          this.unitExtraService.processUnitTriggers(tx, stateId, unitExtra.triggers),
          this.secretService.updateInstanceSecretsCore(
            tx,
            project.libraryId,
            stateId,
            unitExtra.secrets,
          ),
          this.workerService.updateUnitRegistrations(tx, projectId, stateId, unitExtra.workers),
        ])

        unitExtraData = { pageIds, terminalIds, triggerIds, secretNames }

        if (unitExtra.artifactIds !== undefined) {
          await this.unitExtraService.pruneInstanceArtifacts(tx, stateId, unitExtra.artifactIds)
        }
      }

      // update instance state if provided
      if (instanceState) {
        await tx.instanceState.update({
          where: { id: stateId },
          data: instanceState as InstanceStateUpdateInput,
        })
      }

      return { updatedOperationState, unitExtraData }
    })

    if (options.unitExtra?.artifactIds !== undefined) {
      await this.artifactService.collectGarbage(projectId)
    }

    // build patch combining operation state, instance state, and unit extra data
    const patch: Partial<InstanceState> = {
      ...instanceState,
      ...result.unitExtraData,
      lastOperationState: result.updatedOperationState,
    }

    // emit the patch after transaction
    void this.pubsubManager.publish(["instance-state", projectId], {
      type: "patched",
      stateId,
      patch,
    })

    this.logger.debug(
      { projectId, stateId, operationId, options },
      "updated operation state for instance",
    )

    return patch
  }
}
