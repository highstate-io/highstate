import { z } from "zod"
import {
  hubInputSchema,
  instanceInputSchema,
  projectIdSchema,
  successResult,
  type ToolServer,
  toHubMessage,
  toInstanceMessage,
} from "../shared"

export function defineCreateNodesTool(server: ToolServer): void {
  server.mcp.registerTool(
    "create_nodes",
    {
      description:
        "Atomically create resident instances and hubs. Inspect get_project_model and the relevant get_library_objects definitions first, then provide complete valid model objects.",
      inputSchema: {
        project_id: projectIdSchema,
        instances: z.array(instanceInputSchema).default([]),
        hubs: z.array(hubInputSchema).default([]),
      },
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ project_id, instances, hubs }) => {
      await server.clients.projectModel.createNodes({
        projectId: project_id,
        instances: instances.map(toInstanceMessage),
        hubs: hubs.map(toHubMessage),
      })

      return successResult()
    },
  )
}
