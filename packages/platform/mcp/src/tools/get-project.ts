import { GetProjectResponseSchema } from "@highstate/api/v1"
import { messageToolResult, projectIdSchema, type ToolServer } from "../shared"

export function defineGetProjectTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_project",
    {
      description: "Get project metadata. Use this before inspecting or managing a project.",
      inputSchema: {
        project_id: projectIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id }) => {
      const response = await server.clients.project.getProject({ projectId: project_id })

      return messageToolResult(GetProjectResponseSchema, response)
    },
  )
}
