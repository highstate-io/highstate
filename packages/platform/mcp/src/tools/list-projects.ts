import { ListProjectsResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, type ToolServer } from "../shared"

export function defineListProjectsTool(server: ToolServer): void {
  server.mcp.registerTool(
    "list_projects",
    {
      description: "List projects visible to the authenticated API key.",
      inputSchema: {
        page_size: z.number().int().min(1).max(100).optional(),
        page_token: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ page_size, page_token }) => {
      const response = await server.clients.project.listProjects({
        pageSize: page_size,
        pageToken: page_token,
      })

      return messageToolResult(ListProjectsResponseSchema, response)
    },
  )
}
