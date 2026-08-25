import { GetOperationResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, projectIdSchema, type ToolServer } from "../shared"

export function defineGetOperationTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_operation",
    {
      description: "Get the current status and details of an infrastructure operation.",
      inputSchema: {
        project_id: projectIdSchema,
        operation_id: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, operation_id }) => {
      const response = await server.clients.operation.getOperation({
        projectId: project_id,
        operationId: operation_id,
      })

      return messageToolResult(GetOperationResponseSchema, response)
    },
  )
}
