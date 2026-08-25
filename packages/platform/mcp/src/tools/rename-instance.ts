import { RenameInstanceResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, projectIdSchema, type ToolServer } from "../shared"

export function defineRenameInstanceTool(server: ToolServer): void {
  server.mcp.registerTool(
    "rename_instance",
    {
      description:
        "Rename a resident instance and update its Highstate instance ID. Inspect it with get_project_model_objects first.",
      inputSchema: {
        project_id: projectIdSchema,
        instance_id: z.string().min(1),
        new_name: z.string().min(1),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ project_id, instance_id, new_name }) => {
      const response = await server.clients.projectModel.renameInstance({
        projectId: project_id,
        instanceId: instance_id,
        newName: new_name,
      })

      return messageToolResult(RenameInstanceResponseSchema, response)
    },
  )
}
