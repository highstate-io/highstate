import type { ServiceImpl } from "@connectrpc/connect"
import type { Services } from "@highstate/backend"
import {
  HubSchema,
  InstanceSchema,
  type ProjectModelService,
  type UpdateHubRequest,
  type UpdateInstanceRequest,
} from "@highstate/api/v1"
import { projectModelInstanceSchema } from "@highstate/backend/shared"
import { hubModelSchema, instanceIdSchema, z } from "@highstate/contract"
import {
  authenticateProject,
  fromHub,
  fromInstance,
  parseArgument,
  parseValue,
  toHub,
  toHubPatch,
  toInstance,
  toInstancePatch,
  toProjectModel,
  validateUpdateMask,
} from "../shared"

type UpdateInstance = NonNullable<UpdateInstanceRequest["instance"]>
type UpdateHub = NonNullable<UpdateHubRequest["hub"]>

const instanceMutablePaths = new Set([
  "arguments",
  "inputs",
  "hub_inputs",
  "injection_inputs",
  "position",
  "position.x",
  "position.y",
])
const hubMutablePaths = new Set([
  "position",
  "position.x",
  "position.y",
  "inputs",
  "injection_inputs",
])

export function createProjectModelService(
  services: Services,
): ServiceImpl<typeof ProjectModelService> {
  return {
    async getProjectModel(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const [model] = await services.projectModelService.getProjectModel(requestContext, {
        includeVirtualInstances: request.includeVirtualInstances,
        includeGhostInstances: request.includeGhostInstances,
      })

      return { model: toProjectModel(model) }
    },

    async createNodes(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const instances = parseValue(
        request.instances.map(fromInstance),
        "instances",
        projectModelInstanceSchema.array(),
      )
      const hubs = parseValue(request.hubs.map(fromHub), "hubs", hubModelSchema.array())

      await services.projectService.createNodes(requestContext, instances, hubs)

      return {}
    },

    async updateInstance(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const requestInstance = parseArgument(request, "instance", z.custom<UpdateInstance>())
      const instanceId = parseArgument(requestInstance, "id", instanceIdSchema)
      const paths = validateUpdateMask(request.updateMask, InstanceSchema, instanceMutablePaths)
      const patch = toInstancePatch(requestInstance, paths)
      const instance = await services.projectService.updateInstance(
        requestContext,
        instanceId,
        patch,
      )

      return { instance: toInstance(instance) }
    },

    async renameInstance(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const instanceId = parseArgument(request, "instanceId", instanceIdSchema)
      const newName = parseArgument(request, "newName", z.string().min(1))
      const instance = await services.projectService.renameInstance(
        requestContext,
        instanceId,
        newName,
      )

      return { instance: toInstance(instance) }
    },

    async deleteInstance(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const instanceId = parseArgument(request, "instanceId", instanceIdSchema)

      await services.projectService.deleteInstance(requestContext, instanceId)

      return {}
    },

    async updateHub(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const requestHub = parseArgument(request, "hub", z.custom<UpdateHub>())
      const hubId = parseArgument(requestHub, "id", z.cuid2())
      const paths = validateUpdateMask(request.updateMask, HubSchema, hubMutablePaths)
      const patch = toHubPatch(requestHub, paths)
      const hub = await services.projectService.updateHub(requestContext, hubId, patch)

      return { hub: toHub(hub) }
    },

    async deleteHub(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const hubId = parseArgument(request, "hubId", z.cuid2())

      await services.projectService.deleteHub(requestContext, hubId)

      return {}
    },
  }
}
