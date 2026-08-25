import { UpdateInstanceResponseSchema } from "@highstate/api/v1"
import { z } from "zod"
import {
  instancePatchSchema,
  mergePosition,
  messageToolResult,
  projectIdSchema,
  type ToolServer,
  toInstanceMessage,
} from "../shared"

export function defineUpdateInstanceTool(server: ToolServer): void {
  server.mcp.registerTool(
    "update_instance",
    {
      description:
        "Patch an instance's arguments, direct inputs, hub inputs, injected inputs, or canvas position. Inspect the instance with get_project_model_objects and relevant definitions with get_library_objects first.",
      inputSchema: {
        project_id: projectIdSchema,
        instance_id: z.string().min(1),
        patch: instancePatchSchema,
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, instance_id, patch }) => {
      let currentPosition: { x: number; y: number } | undefined
      if ("position" in patch && patch.position !== null && patch.position !== undefined) {
        const modelResponse = await server.clients.projectModel.getProjectModel({
          projectId: project_id,
          includeVirtualInstances: false,
          includeGhostInstances: false,
        })
        const instance = modelResponse.model?.instances.find(value => value.id === instance_id)
        if (!instance) {
          throw new Error(`Instance "${instance_id}" not found`)
        }
        currentPosition = instance.position
      }

      const response = await server.clients.projectModel.updateInstance({
        projectId: project_id,
        instance: toInstanceMessage({
          id: instance_id,
          kind: "unit",
          type: "",
          name: "",
          ...patch,
          position: mergePosition(patch.position, currentPosition),
        }),
        updateMask: { paths: Object.keys(patch) },
      })

      return messageToolResult(UpdateInstanceResponseSchema, response)
    },
  )
}
