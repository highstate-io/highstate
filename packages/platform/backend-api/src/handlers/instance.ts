import type { InstanceServiceImplementation } from "@highstate/api/instance.v1"
import type { Services } from "@highstate/backend"
import { instanceCustomStatusInputSchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticate, parseArgument } from "../shared"

export function createInstanceService(services: Services): InstanceServiceImplementation {
  return {
    async updateCustomStatus(request, context) {
      const [projectId, apiKey] = await authenticate(services, context)

      // TODO: validate instance access

      const stateId = parseArgument(request, "stateId", z.cuid2())
      const customStatus = parseArgument(request, "status", instanceCustomStatusInputSchema)

      await services.instanceStateService.updateCustomStatus(
        projectId,
        stateId,
        apiKey.serviceAccountId,
        customStatus,
      )

      return {}
    },

    async removeCustomStatus(request, context) {
      const [projectId, apiKey] = await authenticate(services, context)

      // TODO: validate instance access

      const stateId = parseArgument(request, "stateId", z.cuid2())

      await services.instanceStateService.removeCustomStatus(
        projectId,
        stateId,
        apiKey.serviceAccountId,
        request.statusName,
      )

      return {}
    },
  }
}
