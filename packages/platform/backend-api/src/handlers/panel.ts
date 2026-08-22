import type { PanelServiceImplementation } from "@highstate/api/panel.v1"
import type { Services } from "@highstate/backend"
import { panelInputSchema } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticate, parseArgument } from "../shared"

export function createPanelService(services: Services): PanelServiceImplementation {
  return {
    async setUnitPanels(request, context) {
      const [projectId, apiKey] = await authenticate(services, context)
      const workerVersionId = parseArgument(request, "workerVersionId", z.cuid2())
      const workerInstanceId = parseArgument(request, "workerInstanceId", z.cuid2())
      const stateId = parseArgument(request, "stateId", z.cuid2())
      const panels = parseArgument(request, "panels", z.array(panelInputSchema))

      const panelIds = await services.panelService.setUnitPanels(
        projectId,
        stateId,
        apiKey.id,
        workerVersionId,
        panels,
        workerInstanceId,
      )

      return { panelIds }
    },
  }
}
