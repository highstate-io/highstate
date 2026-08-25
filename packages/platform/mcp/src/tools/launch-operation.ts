import { LaunchOperationResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import { messageToolResult, operationMetaSchema, type ToolServer } from "../shared"

export function defineLaunchOperationTool(server: ToolServer): void {
  server.mcp.registerTool(
    "launch_operation",
    {
      description:
        "Launch an infrastructure operation using a reviewed plan_id from plan_operation. Destroy, recreate, refresh, debug options, and updates with replacement phases can be destructive or affect external systems.",
      inputSchema: {
        meta: operationMetaSchema,
        plan_id: z.string().uuid(),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ meta, plan_id }) => {
      const plan = server.plans.get(plan_id)
      if (!plan) {
        throw new Error(`Plan "${plan_id}" not found`)
      }

      const response = await server.clients.operation.launchOperation({
        projectId: plan.projectId,
        type: plan.type,
        instanceIds: plan.instanceIds,
        options: plan.options,
        meta,
        plan: plan.phases,
      })
      server.plans.delete(plan_id)

      return messageToolResult(LaunchOperationResponseSchema, response)
    },
  )
}
