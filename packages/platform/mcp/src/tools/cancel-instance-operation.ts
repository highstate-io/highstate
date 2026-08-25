import { z } from "zod"
import { projectIdSchema, successResult, type ToolServer } from "../shared"

export function defineCancelInstanceOperationTool(server: ToolServer): void {
  server.mcp.registerTool(
    "cancel_instance_operation",
    {
      description: "Request cancellation of work for one instance in a running operation.",
      inputSchema: {
        project_id: projectIdSchema,
        operation_id: z.string().min(1),
        instance_id: z.string().min(1),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_id, operation_id, instance_id }) => {
      await server.clients.operation.cancelInstanceOperation({
        projectId: project_id,
        operationId: operation_id,
        instanceId: instance_id,
      })

      return successResult()
    },
  )
}
