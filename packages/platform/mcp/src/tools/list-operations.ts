import { ListOperationsResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, projectIdSchema, type ToolServer } from "../shared"

export function defineListOperationsTool(server: ToolServer): void {
  server.mcp.registerTool(
    "list_operations",
    {
      description: "List recent infrastructure operations, newest first.",
      inputSchema: {
        project_id: projectIdSchema,
        page_size: z.number().int().min(1).max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, page_size }) => {
      const response = await server.clients.operation.listOperations({
        projectId: project_id,
        pageSize: page_size,
      })

      return messageToolResult(ListOperationsResponseSchema, response)
    },
  )
}
