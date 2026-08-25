import { type JsonValue, toJson } from "@bufbuild/protobuf"
import {
  HubSchema,
  type Instance,
  InstanceSchema,
  type InstanceState,
  InstanceStateSchema,
} from "@highstate/api/v1"
import { z } from "zod"
import { getInstanceStates, projectIdSchema, type ToolServer, toolResult } from "../shared"

type InstanceItem = {
  model: JsonValue
  state: JsonValue
  children?: InstanceItem[]
}

export function defineGetProjectModelObjectsTool(server: ToolServer): void {
  server.mcp.registerTool(
    "get_project_model_objects",
    {
      description:
        "Get complete instance and hub objects selected from the project model overview. Set recursive to include nested virtual and ghost children with their models and states.",
      inputSchema: {
        project_id: projectIdSchema,
        instance_ids: z.array(z.string().min(1)).default([]),
        hub_ids: z.array(z.string().min(1)).default([]),
        recursive: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ project_id, instance_ids, hub_ids, recursive }) => {
      const [response, states] = await Promise.all([
        server.clients.projectModel.getProjectModel({
          projectId: project_id,
          includeVirtualInstances: recursive,
          includeGhostInstances: true,
        }),
        getInstanceStates(server.clients, project_id),
      ])

      const instanceIds = new Set(instance_ids)
      const hubIds = new Set(hub_ids)
      const instances = response.model?.instances ?? []
      const statesByInstanceId = new Map(states.map(state => [state.instanceId, state]))
      const childrenByParentId = new Map<string, Instance[]>()

      if (recursive) {
        for (const instance of instances) {
          if (!instance.parentId) {
            continue
          }

          const children = childrenByParentId.get(instance.parentId) ?? []
          children.push(instance)
          childrenByParentId.set(instance.parentId, children)
        }
      }

      return toolResult({
        instances: instances
          .filter(instance => instanceIds.has(instance.id))
          .map(instance => toInstanceItem(instance, statesByInstanceId, childrenByParentId)),
        hubs: response.model?.hubs
          .filter(hub => hubIds.has(hub.id))
          .map(hub => toJson(HubSchema, hub, { useProtoFieldName: true })),
      })
    },
  )
}

function toInstanceItem(
  instance: Instance,
  statesByInstanceId: Map<string, InstanceState>,
  childrenByParentId: Map<string, Instance[]>,
): InstanceItem {
  const children = childrenByParentId
    .get(instance.id)
    ?.map(child => toInstanceItem(child, statesByInstanceId, childrenByParentId))

  const item: InstanceItem = {
    model: toInstanceJson(instance),
    state: toStateJson(statesByInstanceId.get(instance.id)),
  }

  if (children?.length) {
    item.children = children
  }

  return item
}

function toInstanceJson(instance: Instance) {
  return toJson(InstanceSchema, instance, { useProtoFieldName: true })
}

function toStateJson(state: InstanceState | undefined) {
  return state ? toJson(InstanceStateSchema, state, { useProtoFieldName: true }) : null
}
