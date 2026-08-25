import { randomUUID } from "node:crypto"
import { toJson } from "@bufbuild/protobuf"
import { OperationPhaseSchema, OperationType } from "@highstate/api/v1"
import { z } from "zod"
import {
  operationOptionsSchema,
  operationTypeSchema,
  projectIdSchema,
  type ToolServer,
  toOperationOptionsMessage,
  toolResult,
} from "../shared"

export function definePlanOperationTool(server: ToolServer): void {
  server.mcp.registerTool(
    "plan_operation",
    {
      description:
        "Plan an infrastructure operation without executing it. Review every returned phase, then pass plan_id to launch_operation.",
      inputSchema: {
        project_id: projectIdSchema,
        type: operationTypeSchema,
        instance_ids: z.array(z.string().min(1)).min(1),
        options: operationOptionsSchema.optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ project_id, type, instance_ids, options }) => {
      const operationType = toOperationType(type)
      const operationOptions = options ? toOperationOptionsMessage(options) : undefined

      const response = await server.clients.operation.planOperation({
        projectId: project_id,
        type: operationType,
        instanceIds: instance_ids,
        options: operationOptions,
      })

      const planId = randomUUID()
      server.plans.set(planId, {
        projectId: project_id,
        type: operationType,
        instanceIds: instance_ids,
        options: operationOptions,
        phases: response.phases,
      })

      return toolResult({
        plan_id: planId,
        phases: response.phases.map(phase =>
          toJson(OperationPhaseSchema, phase, { useProtoFieldName: true }),
        ),
      })
    },
  )
}

function toOperationType(value: z.infer<typeof operationTypeSchema>): OperationType {
  const types = {
    update: OperationType.UPDATE,
    preview: OperationType.PREVIEW,
    destroy: OperationType.DESTROY,
    recreate: OperationType.RECREATE,
    refresh: OperationType.REFRESH,
  } as const

  return types[value]
}
