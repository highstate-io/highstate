import type { OperationService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect"
import { requireProjectPermission } from "@highstate/backend"
import {
  type Operation,
  operationLaunchInputSchema,
  operationPlanInputSchema,
} from "@highstate/backend/shared"
import { instanceIdSchema, z } from "@highstate/contract"
import {
  authenticateProject,
  fromOperationType,
  parseValue,
  toOperation,
  toOperationLog,
  toOperationPhase,
} from "../shared"

export function createOperationService(services: Services): ServiceImpl<typeof OperationService> {
  return {
    async planOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      requireProjectPermission(requestContext, "operation.create")
      const input = parseValue(
        { ...request, projectId: requestContext.projectId, type: fromOperationType(request.type) },
        "request",
        operationPlanInputSchema,
      )
      const plan = await services.operationManager.planReviewed(input)

      return {
        phases: plan.phases.map(toOperationPhase),
        plan: {
          ...plan,
          phases: plan.phases.map(toOperationPhase),
          librarySnapshotId: plan.librarySnapshotId ?? undefined,
          localOverlayRevision: plan.localOverlayRevision ?? undefined,
        },
      }
    },

    async launchOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      requireProjectPermission(requestContext, "operation.create")
      if (request.plan.length && !request.planToken) {
        throw new ConnectError(
          "Review a backend-issued plan and provide its plan token",
          Code.FailedPrecondition,
        )
      }
      const input = parseValue(
        {
          ...request,
          projectId: requestContext.projectId,
          type: fromOperationType(request.type),
          plan: undefined,
          planToken: request.planToken,
        },
        "request",
        operationLaunchInputSchema,
      )
      let operation: Operation
      try {
        operation = await services.operationManager.launch(input)
      } catch (error) {
        if (
          error instanceof Error &&
          /^(Reviewed plan (is stale or does not match the launch request|expired)|Invalid reviewed plan (token|signature))$/.test(
            error.message,
          )
        ) {
          throw new ConnectError(
            "The reviewed plan is stale or invalid; review a new plan before launching",
            Code.FailedPrecondition,
          )
        }
        throw error
      }

      return { operation: toOperation(operation) }
    },

    async getOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))

      const operation = await services.operationService.getOperationOrThrow(
        requestContext,
        operationId,
      )

      return { operation: toOperation(operation) }
    },

    async listOperations(request, context) {
      const requestContext = await authenticateProject(services, request, context)

      const page = await services.operationService.getOperations(requestContext, {
        pageSize: request.pageSize,
        pageToken: request.pageToken,
      })

      return { operations: page.items.map(toOperation), nextPageToken: page.nextPageToken }
    },

    async listOperationLogs(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))
      const stateId = parseValue(request.stateId, "stateId", z.cuid2().optional())
      await services.operationService.getOperationOrThrow(requestContext, operationId)

      const page = await services.operationService.getOperationLogs(
        requestContext,
        operationId,
        stateId,
        { pageSize: request.pageSize, pageToken: request.pageToken },
      )

      return {
        logs: page.items.map(log => toOperationLog(operationId, log)),
        nextPageToken: page.nextPageToken,
      }
    },

    async cancelOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      requireProjectPermission(requestContext, "operation.cancel")
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))
      await services.operationService.getOperationOrThrow(requestContext, operationId)

      const forceRequired = services.operationManager.cancel(operationId, request.force)

      return { forceRequired }
    },

    async cancelInstanceOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      requireProjectPermission(requestContext, "operation.cancel")
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))
      const instanceId = parseValue(request.instanceId, "instanceId", instanceIdSchema)
      await services.operationService.getOperationOrThrow(requestContext, operationId)

      const forceRequired = services.operationManager.cancelInstance(
        operationId,
        instanceId,
        request.force,
      )

      return { forceRequired }
    },
  }
}
