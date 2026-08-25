import { z } from "zod"
import { projectIdSchema, successResult, type ToolServer } from "../shared"

export function defineCancelOperationTool(server: ToolServer): void {
  server.mcp.registerTool(
    "cancel_operation",
    {
      description: "Request cancellation of a running infrastructure operation.",
      inputSchema: {
        project_id: projectIdSchema,
        operation_id: z.string().min(1),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_id, operation_id }) => {
      await server.clients.operation.cancelOperation({
        projectId: project_id,
        operationId: operation_id,
      })

      return successResult()
    },
  )
}
