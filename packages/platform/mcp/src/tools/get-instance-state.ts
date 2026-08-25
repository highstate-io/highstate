import { GetInstanceStateResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, projectIdSchema, type ToolServer } from "../shared"

export function defineGetInstanceStateTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_instance_state",
    {
      description: "Get the complete observed runtime state for one stable instance state ID.",
      inputSchema: {
        project_id: projectIdSchema,
        state_id: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, state_id }) => {
      const response = await server.clients.instanceState.getInstanceState({
        projectId: project_id,
        stateId: state_id,
        includeEvaluationState: true,
        includeLastOperationState: true,
        includeParentInstanceId: true,
        includeExtra: true,
        includeCustomStatuses: true,
      })

      return messageToolResult(GetInstanceStateResponseSchema, response)
    },
  )
}
