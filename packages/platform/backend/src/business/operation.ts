import type { InstanceId } from "@highstate/contract"
import type { Logger } from "pino"
import type { ProjectRequestContext } from "../common"
import type {
  DatabaseManager,
  Operation,
  OperationStatus,
  OperationUpdateInput,
  OperationWhereInput,
} from "../database"
import type { PubSubManager } from "../pubsub"
import type { ObjectRefIndexService } from "./object-ref-index"
import { ulid } from "ulid"
import { z } from "zod"
import {
  buildProjectAuthorizationWhere,
  encodePageToken,
  requireProjectPermission,
  resolvePageRequest,
  toPageResult,
} from "../common"
import {
  type OperationMeta,
  OperationNotFoundError,
  type OperationOptions,
  type OperationType,
  type PageRequest,
  type PageResult,
} from "../shared"

export class OperationService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
    private readonly objectRefIndexService: ObjectRefIndexService,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates a new operation in the database.
   *
   * @param projectId The project ID to which the operation belongs.
   * @param meta The operation metadata.
   * @param type The operation type.
   * @param requestedInstanceIds The instance IDs that were explicitly requested.
   * @param options The operation options.
   * @returns The created operation.
   */
  async createOperation(
    projectId: string,
    meta: OperationMeta,
    type: OperationType,
    requestedInstanceIds: InstanceId[],
    options: OperationOptions,
  ): Promise<Operation> {
    const database = await this.database.forProject(projectId)

    const operation = await database.operation.create({
      data: {
        meta,
        type,
        options,
        requestedInstanceIds,
        startedAt: new Date(),
      },
    })

    await this.objectRefIndexService.track(projectId, [operation.id])

    await this.pubsubManager.publish(["operation", projectId], {
      type: "updated",
      operation,
    })

    this.logger.info({ projectId, operationId: operation.id }, "created operation")
    return operation
  }

  /**
   * Updates an existing operation in the database.
   *
   * @param projectId The project ID containing the operation.
   * @param operationId The operation ID to update.
   * @param updates The updates to apply.
   * @returns The updated operation.
   */
  async updateOperation(
    projectId: string,
    operationId: string,
    updates: OperationUpdateInput,
  ): Promise<Operation> {
    const database = await this.database.forProject(projectId)

    const operation = await database.operation.update({
      where: { id: operationId },
      data: updates,
    })

    await this.pubsubManager.publish(["operation", projectId], {
      type: "updated",
      operation,
    })

    this.logger.info({ projectId, operationId }, "updated operation")
    return operation
  }

  /**
   * Gets an operation by ID.
   *
   * @param projectId The project ID containing the operation.
   * @param operationId The operation ID.
   * @returns The operation or undefined if not found.
   */
  async getOperation(
    context: ProjectRequestContext,
    operationId: string,
  ): Promise<Operation | undefined> {
    const database = await this.database.forProject(context.projectId)

    const operation = await database.operation.findUnique({
      where: { id: operationId },
    })

    if (!operation) {
      return undefined
    }

    requireProjectPermission(context, "operation.get", { resourceId: operation.id })

    return operation
  }

  async getOperationOrThrow(
    context: ProjectRequestContext,
    operationId: string,
  ): Promise<Operation> {
    const operation = await this.getOperation(context, operationId)
    if (!operation) {
      throw new OperationNotFoundError(context.projectId, operationId)
    }

    return operation
  }

  /**
   * Gets all operations for a project.
   *
   * @param projectId The project ID.
   * @param page The requested cursor page.
   * @returns One page of operations.
   */
  async getOperations(
    context: ProjectRequestContext,
    page: PageRequest = {},
  ): Promise<PageResult<Operation>> {
    const database = await this.database.forProject(context.projectId)

    const collection = "operations"
    const query = { projectId: context.projectId }
    const { pageSize, cursor } = resolvePageRequest(
      collection,
      page,
      query,
      z.object({ startedAt: z.iso.datetime(), id: z.string().min(1) }),
    )

    const authorization = await buildProjectAuthorizationWhere<OperationWhereInput>({
      database: this.database,
      context,
      permission: "operation.list",
      target: {
        resources: ids => ({ id: { in: [...ids] } }),
        instances: scope => ({
          operationStates: { some: { stateId: { in: [...scope.stateIds] } } },
        }),
      },
    })

    const continuation = cursor
      ? {
          OR: [
            { startedAt: { lt: new Date(cursor.startedAt) } },
            { startedAt: new Date(cursor.startedAt), id: { lt: cursor.id } },
          ],
        }
      : {}
    const operations = await database.operation.findMany({
      where: { AND: [authorization, continuation] },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
    })

    return toPageResult(operations, pageSize, operation =>
      encodePageToken(collection, query, {
        startedAt: operation.startedAt.toISOString(),
        id: operation.id,
      }),
    )
  }

  /**
   * Appends log for a specific operation.
   *
   * @param projectId The ID of the project to persist the log for.
   * @param operationId The ID of the operation to persist the log for.
   * @param stateId The ID of the instance state that produced the log (optional).
   * @param content The log content to append.
   */
  async appendLog(
    projectId: string,
    operationId: string,
    stateId: string | null,
    content: string,
  ): Promise<void> {
    const database = await this.database.forProject(projectId)

    // verify operation exists
    const operation = await database.operation.findUnique({
      where: { id: operationId },
      select: { id: true, finishedAt: true },
    })

    if (!operation) {
      throw new OperationNotFoundError(projectId, operationId)
    }

    // store logs in database
    const entry = await database.operationLog.create({
      data: {
        id: ulid(),
        operationId,
        stateId,
        content,
      },
    })

    // publish logs via pubsub - only for logs with stateId (not system logs)
    if (stateId) {
      await this.pubsubManager.publish(["operation-instance-log", operationId, stateId], entry)
    }
  }

  /**
   * Retrieves logs for a specific operation and optionally an instance.
   *
   * @param projectId The ID of the project to retrieve logs for.
   * @param operationId The ID of the operation to retrieve logs for.
   * @param stateId Optional instance state ID to filter logs.
   * @returns Array of log entries.
   */
  async getOperationLogs(
    context: ProjectRequestContext,
    operationId: string,
    stateId?: string,
    page: PageRequest = {},
  ): Promise<
    PageResult<{ id: string; stateId: string | null; isSystem: boolean; content: string }>
  > {
    requireProjectPermission(context, "operation.logs.get", { resourceId: operationId })

    const database = await this.database.forProject(context.projectId)

    const collection = "operation-logs"
    const query = { projectId: context.projectId, operationId, stateId }
    const { pageSize, cursor } = resolvePageRequest(
      collection,
      page,
      query,
      z.object({ id: z.string().min(1) }),
    )
    const logs = await database.operationLog.findMany({
      where: {
        operationId,
        ...(stateId ? { stateId } : {}),
        ...(cursor ? { id: { gt: cursor.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: pageSize + 1,
      select: {
        id: true,
        stateId: true,
        isSystem: true,
        content: true,
      },
    })

    return toPageResult(logs, pageSize, log => encodePageToken(collection, query, { id: log.id }))
  }

  /**
   * Marks an operation as finished with given status.
   *
   * @param projectId The project ID containing the operation.
   * @param operationId The operation ID to complete.
   * @returns The updated operation.
   */
  async markOperationFinished(
    projectId: string,
    operationId: string,
    status: OperationStatus,
  ): Promise<Operation> {
    const result = await this.updateOperation(projectId, operationId, {
      status,
      finishedAt: new Date(),
    })

    this.logger.info(
      { projectId, operationId, status },
      `marked operation as finished with status "${status}"`,
    )

    return result
  }
}
