import type { Hub, Instance } from "@highstate/api/v1"
import { projectIdSchema, type ToolServer, toolResult } from "../shared"

export function defineGetProjectModelTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_project_model",
    {
      description:
        "Get a compact overview of resident and ghost instances, hubs, and their direct dependencies. Use get_project_model_objects for complete model objects.",
      inputSchema: {
        project_id: projectIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id }) => {
      const [residentResponse, fullResponse] = await Promise.all([
        server.clients.projectModel.getProjectModel({
          projectId: project_id,
          includeVirtualInstances: false,
          includeGhostInstances: false,
        }),
        server.clients.projectModel.getProjectModel({
          projectId: project_id,
          includeVirtualInstances: false,
          includeGhostInstances: true,
        }),
      ])
      const residentIds = new Set(
        residentResponse.model?.instances.map(instance => instance.id) ?? [],
      )

      return toolResult({
        instances: fullResponse.model?.instances.map(instance => ({
          instance_id: instance.id,
          is_ghost: !residentIds.has(instance.id),
          dependencies: getInstanceDependencies(instance),
        })),
        hubs: fullResponse.model?.hubs.map(hub => ({
          hub_id: hub.id,
          dependencies: getHubDependencies(hub),
        })),
      })
    },
  )
}

function getInstanceDependencies(
  instance: Instance,
): Array<{ instance_id: string } | { hub_id: string }> {
  const instanceIds = new Set(
    Object.values(instance.inputs).flatMap(references =>
      references.values.map(reference => reference.instanceId),
    ),
  )
  const hubIds = new Set([
    ...Object.values(instance.hubInputs).flatMap(references =>
      references.values.map(reference => reference.hubId),
    ),
    ...instance.injectionInputs.map(reference => reference.hubId),
  ])

  return [
    ...Array.from(instanceIds, instance_id => ({ instance_id })),
    ...Array.from(hubIds, hub_id => ({ hub_id })),
  ]
}

function getHubDependencies(hub: Hub): Array<{ instance_id: string } | { hub_id: string }> {
  const instanceIds = new Set(hub.inputs.map(reference => reference.instanceId))
  const hubIds = new Set(hub.injectionInputs.map(reference => reference.hubId))

  return [
    ...Array.from(instanceIds, instance_id => ({ instance_id })),
    ...Array.from(hubIds, hub_id => ({ hub_id })),
  ]
}
