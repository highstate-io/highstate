import type { ServiceImpl } from "@connectrpc/connect"
import type { InstanceStateService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { instanceCustomStatusInputSchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import {
  authenticateProject,
  parseArgument,
  toInstanceCustomStatus,
  toInstanceState,
} from "../shared"

export function createInstanceStateService(
  services: Services,
): ServiceImpl<typeof InstanceStateService> {
  return {
    async listInstanceStates(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const page = await services.instanceStateService.getInstanceStates(
        requestContext,
        {
          includeEvaluationState: request.includeEvaluationState,
          includeLastOperationState: request.includeLastOperationState,
          includeParentInstanceId: request.includeParentInstanceId,
          includeExtra: request.includeExtra,
          loadCustomStatuses: request.includeCustomStatuses,
        },
        { pageSize: request.pageSize, pageToken: request.pageToken },
      )

      return { states: page.items.map(toInstanceState), nextPageToken: page.nextPageToken }
    },

    async getInstanceState(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const state = await services.instanceStateService.getInstanceStateOrThrow(
        requestContext,
        stateId,
        {
          includeEvaluationState: request.includeEvaluationState,
          includeLastOperationState: request.includeLastOperationState,
          includeParentInstanceId: request.includeParentInstanceId,
          includeExtra: request.includeExtra,
          loadCustomStatuses: request.includeCustomStatuses,
        },
      )

      return { state: toInstanceState(state) }
    },

    async updateCustomStatus(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const customStatus = parseArgument(request, "status", instanceCustomStatusInputSchema)

      await services.instanceStateService.updateCustomStatus(
        requestContext,
        stateId,
        requestContext.subject.serviceAccountId,
        customStatus,
      )

      const state = await services.instanceStateService.getInstanceStateOrThrow(
        requestContext,
        stateId,
        { loadCustomStatuses: true },
      )
      const status = state.customStatuses?.find(
        value =>
          value.name === customStatus.name &&
          value.serviceAccountId === requestContext.subject.serviceAccountId,
      )
      if (!status) {
        throw new Error("Updated custom status was not returned by the backend")
      }

      return { status: toInstanceCustomStatus(status) }
    },

    async removeCustomStatus(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const statusName = parseArgument(request, "statusName", z.string().min(1))

      await services.instanceStateService.removeCustomStatus(
        requestContext,
        stateId,
        requestContext.subject.serviceAccountId,
        statusName,
      )

      return {}
    },
  }
}
