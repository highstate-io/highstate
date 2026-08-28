import { hubIdSchema, projectIdSchema, successResult, type ToolServer } from "../shared"

export function defineDeleteHubTool(server: ToolServer): void {
  server.mcp.registerTool(
    "delete_hub",
    {
      description:
        "Delete a resident hub from the desired project model. Inspect it with get_project_model_objects first.",
      inputSchema: {
        project_id: projectIdSchema,
        hub_id: hubIdSchema,
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, hub_id }) => {
      await server.clients.projectModel.deleteHub({ projectId: project_id, hubId: hub_id })

      return successResult()
    },
  )
}
