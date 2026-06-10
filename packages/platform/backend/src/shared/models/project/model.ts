import {
  type HubModel,
  hubModelSchema,
  type InstanceModel,
  instanceIdSchema,
  instanceModelSchema,
} from "@highstate/contract"
import { z } from "zod"

export const projectModelInstanceSchema = instanceModelSchema.pick({
  id: true,
  kind: true,
  type: true,
  name: true,
  args: true,
  inputs: true,
  hubInputs: true,
  injectionInputs: true,
  position: true,
})

export type ProjectModelInstance = z.infer<typeof projectModelInstanceSchema>

export const projectModelEventSchema = z.object({
  updatedInstances: instanceModelSchema.array().optional(),
  updatedHubs: hubModelSchema.array().optional(),
  updatedVirtualInstances: instanceModelSchema.array().optional(),
  updatedGhostInstances: instanceModelSchema.array().optional(),

  deletedInstanceIds: instanceIdSchema.array().optional(),
  deletedHubIds: z.string().array().optional(),
  deletedVirtualInstanceIds: instanceIdSchema.array().optional(),
  deletedGhostInstanceIds: instanceIdSchema.array().optional(),
})

export type ProjectNodeEvent = z.infer<typeof projectModelEventSchema>

export type ProjectModel = {
  instances: InstanceModel[]
  hubs: HubModel[]
}

export type FullProjectModel = ProjectModel & {
  virtualInstances: InstanceModel[]
  ghostInstances: InstanceModel[]
}
