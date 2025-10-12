import { defineEntity, z } from "@highstate/contract"
import { scopedResourceSchema } from "./resources"
import { serviceEntity } from "./service"

/**
 * The entity which represents a Kubernetes deployment managed by Highstate.
 *
 * Also includes a service associated with the deployment.
 */
export const deploymentEntity = defineEntity({
  type: "k8s.deployment.v1",

  schema: z.object({
    ...scopedResourceSchema.shape,
    type: z.literal("deployment"),
    service: serviceEntity.schema.optional(),
  }),

  meta: {
    color: "#4CAF50",
  },
})

/**
 * The entity which represents a Kubernetes stateful set managed by Highstate.
 *
 * Also includes a service associated with the stateful set.
 */
export const statefulSetEntity = defineEntity({
  type: "k8s.stateful-set.v1",

  schema: z.object({
    ...scopedResourceSchema.shape,
    type: z.literal("stateful-set"),
    service: serviceEntity.schema,
  }),

  meta: {
    color: "#FFC107",
  },
})

/**
 * The entity which represents a Kubernetes workload exposed via a service.
 *
 * It can be either a deployment or a stateful set.
 */
export const exposableWorkloadEntity = defineEntity({
  type: "k8s.exposable-workload.v1",

  schema: z.union([deploymentEntity.schema, statefulSetEntity.schema]),

  meta: {
    color: "#4CAF50",
  },
})

/**
 * The network interface in a network namespace of the pod which can accept and transmit network traffic.
 */
export const networkInterfaceEntity = defineEntity({
  type: "k8s.network-interface.v1",

  schema: z.object({
    name: z.string(),
    workload: exposableWorkloadEntity.schema,
  }),

  meta: {
    color: "#2196F3",
  },
})

export type Deployment = z.infer<typeof deploymentEntity.schema>
export type StatefulSet = z.infer<typeof statefulSetEntity.schema>
export type ExposableWorkload = z.infer<typeof exposableWorkloadEntity.schema>
export type NetworkInterface = z.infer<typeof networkInterfaceEntity.schema>
