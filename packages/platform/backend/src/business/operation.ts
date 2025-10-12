import type { InstanceId } from "@highstate/contract"
import type { Logger } from "pino"
import type { DatabaseManager, Operation, OperationStatus, OperationUpdateInput } from "../database"
import type { PubSubManager } from "../pubsub"
import { ulid } from "ulid"
import {
  type OperationMeta,
  OperationNotFoundError,
  type OperationOptions,
  type OperationType,
} from "../shared"

export class OperationService {
  constructor(
    private readonly database: DatabaseManager,
    private readonly pubsubManager: PubSubManager,
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
  async getOperation(projectId: string, operationId: string): Promise<Operation | undefined> {
    const database = await this.database.forProject(projectId)

    const operation = await database.operation.findUnique({
      where: { id: operationId },
    })

    return operation ?? undefined
  }

  /**
   * Gets all operations for a project.
   *
   * @param projectId The project ID.
   * @param limit Optional limit on number of operations to return.
   * @returns Array of operations.
   */
  async getOperations(projectId: string, limit?: number): Promise<Operation[]> {
    const database = await this.database.forProject(projectId)

    return await database.operation.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    })
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
    projectId: string,
    operationId: string,
    stateId?: string,
  ): Promise<Array<{ id: string; stateId: string | null; content: string }>> {
    const database = await this.database.forProject(projectId)

    const logs = await database.operationLog.findMany({
      where: {
        operationId,
        ...(stateId ? { stateId } : {}),
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        stateId: true,
        content: true,
      },
    })

    return logs
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
