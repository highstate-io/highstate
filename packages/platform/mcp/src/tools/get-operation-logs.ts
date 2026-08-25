import type { OperationLog } from "@highstate/api/v1"
import { z } from "zod"
import {
  getInstanceStates,
  projectIdSchema,
  type ToolServer,
  textToolResult,
  timestampFromUlid,
} from "../shared"

export function defineGetOperationLogsTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_operation_logs",
    {
      description:
        "Get operation logs as chronological text lines, optionally filtered by instance state.",
      inputSchema: {
        project_id: projectIdSchema,
        operation_id: z.string().min(1),
        state_id: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, operation_id, state_id }) => {
      const [logs, states] = await Promise.all([
        getLogs(server, project_id, operation_id, state_id),
        state_id === undefined
          ? getInstanceStates(server.clients, project_id)
          : Promise.resolve([]),
      ])

      if (logs.length === 0) {
        return textToolResult("No logs")
      }

      const instanceIdsByStateId = new Map(states.map(state => [state.id, state.instanceId]))

      return textToolResult(logs.map(log => formatLog(log, instanceIdsByStateId)).join("\n"))
    },
  )
}

async function getLogs(
  server: ToolServer,
  projectId: string,
  operationId: string,
  stateId: string | undefined,
): Promise<OperationLog[]> {
  const logs: OperationLog[] = []
  let pageToken = ""

  do {
    const response = await server.clients.operation.listOperationLogs({
      projectId,
      operationId,
      stateId,
      pageSize: 100,
      pageToken,
    })
    logs.push(...response.logs)
    pageToken = response.nextPageToken
  } while (pageToken)

  return logs
}

function formatLog(log: OperationLog, instanceIdsByStateId: Map<string, string>): string {
  const prefixes = [`[${timestampFromUlid(log.id)}]`]
  if (log.isSystem) {
    prefixes.push("[system]")
  }
  if (log.stateId && instanceIdsByStateId.size > 0) {
    prefixes.push(`[instance "${instanceIdsByStateId.get(log.stateId) ?? log.stateId}"]`)
  }

  return `${prefixes.join(" ")} ${log.content.replaceAll(/\r?\n/g, "\\n")}`
}
