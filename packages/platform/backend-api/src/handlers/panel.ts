import type { ServiceImpl } from "@connectrpc/connect"
import type { PanelService } from "@highstate/api/v1"
import type { Services } from "@highstate/backend"
import { panelInputSchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateProject, parseArgument } from "../shared"

export function createPanelService(services: Services): ServiceImpl<typeof PanelService> {
  return {
    async setUnitPanels(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const workerVersionId = parseArgument(request, "workerVersionId", z.cuid2())
      const workerInstanceId = parseArgument(request, "workerInstanceId", z.cuid2())
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const panels = parseArgument(request, "panels", z.array(panelInputSchema))

      const panelIds = await services.panelService.setUnitPanels(
        requestContext,
        stateId,
        requestContext.subject.apiKeyId,
        workerVersionId,
        panels,
        workerInstanceId,
      )

      return { panelIds }
    },
  }
}
