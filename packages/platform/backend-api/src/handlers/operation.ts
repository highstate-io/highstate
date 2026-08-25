import type { ServiceImpl } from "@connectrpc/connect"
import type { OperationService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { operationLaunchInputSchema, operationPlanInputSchema } from "@highstate/backend/shared"
import { instanceIdSchema, z } from "@highstate/contract"
import {
  authenticateProject,
  fromOperationPhase,
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
      const input = parseValue(
        { ...request, projectId: requestContext.projectId, type: fromOperationType(request.type) },
        "request",
        operationPlanInputSchema,
      )
      const phases = await services.operationManager.plan(input)

      return { phases: phases.map(toOperationPhase) }
    },

    async launchOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const input = parseValue(
        {
          ...request,
          projectId: requestContext.projectId,
          type: fromOperationType(request.type),
          plan: request.plan.length > 0 ? request.plan.map(fromOperationPhase) : undefined,
        },
        "request",
        operationLaunchInputSchema,
      )
      const operation = await services.operationManager.launch(input)

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
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))
      await services.operationService.getOperationOrThrow(requestContext, operationId)

      services.operationManager.cancel(operationId)

      return {}
    },

    async cancelInstanceOperation(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const operationId = parseValue(request.operationId, "operationId", z.string().min(1))
      const instanceId = parseValue(request.instanceId, "instanceId", instanceIdSchema)
      await services.operationService.getOperationOrThrow(requestContext, operationId)

      services.operationManager.cancelInstance(operationId, instanceId)

      return {}
    },
  }
}
