import { defineEntity, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { namespacedResourceEntity } from "./resources"
import { serviceEntity } from "./service"

/**
 * The entity which represents a Kubernetes workload.
 */
export const workloadEntity = defineEntity({
  type: "k8s.workload.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#9C27B0",
  },
})

/**
 * The entity which represents a Kubernetes job managed by Highstate.
 */
export const jobEntity = defineEntity({
  type: "k8s.job.v1",

  extends: { workloadEntity },

  schema: z.unknown(),

  meta: {
    color: "#FF5722",
  },
})

/**
 * The entity which represents a Kubernetes cron job managed by Highstate.
 */
export const cronJobEntity = defineEntity({
  type: "k8s.cron-job.v1",

  extends: { workloadEntity },

  schema: z.unknown(),

  meta: {
    color: "#FF9800",
  },
})

/**
 * The entity which represents a Kubernetes workload (optionally) exposed via a service.
 *
 * Includes both the workload and its associated service.
 */
export const exposableWorkloadEntity = defineEntity({
  type: "k8s.exposable-workload.v1",

  extends: { workloadEntity },

  includes: {
    service: {
      entity: serviceEntity,
      required: false,
    },

    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#4CAF50",
  },
})

/**
 * The entity which represents a Kubernetes deployment managed by Highstate.
 *
 * Also includes a service associated with the deployment.
 */
export const deploymentEntity = defineEntity({
  type: "k8s.deployment.v1",

  extends: { exposableWorkloadEntity },
  schema: z.unknown(),

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

  extends: { exposableWorkloadEntity },

  includes: {
    service: serviceEntity,
  },

  schema: z.unknown(),

  meta: {
    color: "#FFC107",
  },
})

/**
 * The network interface in a network namespace of the pod which can accept and transmit network traffic.
 */
export const networkInterfaceEntity = defineEntity({
  type: "k8s.network-interface.v1",

  schema: z.object({
    name: z.string(),
    workload: workloadEntity.schema,
  }),

  meta: {
    color: "#2196F3",
  },
})

export type Workload = z.infer<typeof workloadEntity.schema>
export type Job = z.infer<typeof jobEntity.schema>
export type CronJob = z.infer<typeof cronJobEntity.schema>
export type ExposableWorkload = z.infer<typeof exposableWorkloadEntity.schema>
export type Deployment = z.infer<typeof deploymentEntity.schema>
export type StatefulSet = z.infer<typeof statefulSetEntity.schema>
export type NetworkInterface = z.infer<typeof networkInterfaceEntity.schema>
