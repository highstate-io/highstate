import type { StoredPlan, ToolServer } from "./shared"
import { readCurrentPackageVersion } from "@highstate/cli/shared"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createHighstateClients, type HighstateCredentials } from "./client"
import {
  defineCancelInstanceOperationTool,
  defineCancelOperationTool,
  defineCreateNodesTool,
  defineDeleteHubTool,
  defineDeleteInstanceTool,
  defineGetInstanceStateTool,
  defineGetLibraryObjectSchemasTool,
  defineGetLibraryObjectsTool,
  defineGetLibraryTool,
  defineGetOperationLogsTool,
  defineGetOperationTool,
  defineGetProjectModelObjectsTool,
  defineGetProjectModelTool,
  defineGetProjectTool,
  defineLaunchOperationTool,
  defineListOperationsTool,
  defineListProjectsTool,
  definePlanOperationTool,
  defineRenameInstanceTool,
  defineUpdateHubTool,
  defineUpdateInstanceTool,
} from "./tools"

const version = await readCurrentPackageVersion(import.meta.url)

export function createHighstateMcpServer(
  apiUrl: string,
  credentials: HighstateCredentials,
  plans: Map<string, StoredPlan> = new Map(),
) {
  const mcp = new McpServer(
    {
      name: "highstate",
      version,
      description: "Inspect and manage Highstate infrastructure projects",
    },
    {
      instructions:
        "Inspect the project, project model, and library overviews before requesting relevant objects or editing the model. Library object schemas are large: avoid retrieving schemas for objects that are not needed. Request only the specific component or entity schemas required for the current task with get_library_object_schemas. Plan infrastructure operations before launching them. Treat destroy, recreate, deletion, and debug operations as potentially destructive.",
    },
  )
  const server: ToolServer = {
    mcp,
    clients: createHighstateClients(apiUrl, credentials),
    plans,
  }

  defineGetProjectTool(server)
  defineListProjectsTool(server)
  defineGetProjectModelTool(server)
  defineGetProjectModelObjectsTool(server)
  defineGetLibraryTool(server)
  defineGetLibraryObjectsTool(server)
  defineGetLibraryObjectSchemasTool(server)
  defineGetInstanceStateTool(server)
  defineCreateNodesTool(server)
  defineUpdateInstanceTool(server)
  defineRenameInstanceTool(server)
  defineDeleteInstanceTool(server)
  defineUpdateHubTool(server)
  defineDeleteHubTool(server)
  definePlanOperationTool(server)
  defineLaunchOperationTool(server)
  defineGetOperationTool(server)
  defineListOperationsTool(server)
  defineGetOperationLogsTool(server)
  defineCancelOperationTool(server)
  defineCancelInstanceOperationTool(server)

  return {
    server: mcp,
    async close() {
      await mcp.close()
    },
  }
}
