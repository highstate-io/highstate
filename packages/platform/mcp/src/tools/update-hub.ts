import { UpdateHubResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import {
  hubPatchSchema,
  mergePosition,
  messageToolResult,
  projectIdSchema,
  type ToolServer,
  toHubMessage,
} from "../shared"

export function defineUpdateHubTool(server: ToolServer): void {
  server.mcp.registerTool(
    "update_hub",
    {
      description:
        "Patch a resident hub's inputs, injected inputs, or canvas position. Inspect it with get_project_model_objects first.",
      inputSchema: {
        project_id: projectIdSchema,
        hub_id: z.string().min(1),
        patch: hubPatchSchema,
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, hub_id, patch }) => {
      let currentPosition: { x: number; y: number } | undefined
      if ("position" in patch && patch.position !== null && patch.position !== undefined) {
        const modelResponse = await server.clients.projectModel.getProjectModel({
          projectId: project_id,
          includeVirtualInstances: false,
          includeGhostInstances: false,
        })
        const hub = modelResponse.model?.hubs.find(value => value.id === hub_id)
        if (!hub) {
          throw new Error(`Hub "${hub_id}" not found`)
        }
        currentPosition = hub.position
      }

      const response = await server.clients.projectModel.updateHub({
        projectId: project_id,
        hub: toHubMessage({
          id: hub_id,
          ...patch,
          position: mergePosition(patch.position, currentPosition),
        }),
        updateMask: { paths: Object.keys(patch) },
      })

      return messageToolResult(UpdateHubResponseSchema, response)
    },
  )
}
