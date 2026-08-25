import { z } from "zod"
import { projectIdSchema, successResult, type ToolServer } from "../shared"

export function defineDeleteInstanceTool(server: ToolServer): void {
  server.mcp.registerTool(
    "delete_instance",
    {
      description:
        "Delete a resident instance from the desired project model. This does not automatically destroy deployed infrastructure; inspect its model object and state, then plan a destroy operation first.",
      inputSchema: {
        project_id: projectIdSchema,
        instance_id: z.string().min(1),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, instance_id }) => {
      await server.clients.projectModel.deleteInstance({
        projectId: project_id,
        instanceId: instance_id,
      })

      return successResult()
    },
  )
}
