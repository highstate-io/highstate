import { defineEntity, type EntityInput, type EntityValue, z } from "@highstate/contract"
import { namespacedResourceEntity } from "./resources"
import { serviceEntity } from "./service"

/**
 * The entity which represents a Kubernetes workload.
 *
 * Can optionally include a service associated with the workload.
 */
export const workloadEntity = defineEntity({
  type: "k8s.workload.v1",

  extends: { namespacedResourceEntity },

  includes: {
    service: {
      entity: serviceEntity,
      required: false,
    },
  },

  schema: z.object({
    spec: z.object({
      template: z.object({
        spec: z.object({
          containers: z.array(
            z.object({
              name: z.string(),
              ports: z.array(
                z.object({
                  containerPort: z.number(),
                }),
              ),
            }),
          ),
        }),
      }),
    }),
  }),

  meta: {
    color: "#9C27B0",
    title: "Workload",
    icon: "devicon:kubernetes",
    iconColor: "#9C27B0",
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
    title: "Job",
    icon: "devicon:kubernetes",
    iconColor: "#FF5722",
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
    title: "CronJob",
    icon: "devicon:kubernetes",
    iconColor: "#FF9800",
  },
})

/**
 * The entity which represents a Kubernetes deployment managed by Highstate.
 *
 * Also includes a service associated with the deployment.
 */
export const deploymentEntity = defineEntity({
  type: "k8s.deployment.v1",

  extends: { workloadEntity },
  schema: z.unknown(),

  meta: {
    color: "#4CAF50",
    title: "Deployment",
    icon: "devicon:kubernetes",
    iconColor: "#4CAF50",
  },
})

/**
 * The entity which represents a Kubernetes stateful set managed by Highstate.
 *
 * Also includes a service associated with the stateful set.
 */
export const statefulSetEntity = defineEntity({
  type: "k8s.stateful-set.v1",

  extends: { workloadEntity },

  includes: {
    service: serviceEntity,
  },

  schema: z.unknown(),

  meta: {
    color: "#FFC107",
    title: "Stateful Set",
    icon: "devicon:kubernetes",
    iconColor: "#FFC107",
  },
})

/**
 * The network interface in a network namespace of the pod which can accept and transmit network traffic.
 */
export const networkInterfaceEntity = defineEntity({
  type: "k8s.network-interface.v1",

  includes: {
    workload: workloadEntity,
  },

  schema: z.object({
    name: z.string(),
  }),

  meta: {
    color: "#2196F3",
    title: "Network Interface",
    icon: "devicon:kubernetes",
    iconColor: "#2196F3",
  },
})

export type Workload = EntityValue<typeof workloadEntity>
export type WorkloadInput = EntityInput<typeof workloadEntity>
export type Job = EntityValue<typeof jobEntity>
export type JobInput = EntityInput<typeof jobEntity>
export type CronJob = EntityValue<typeof cronJobEntity>
export type CronJobInput = EntityInput<typeof cronJobEntity>
export type Deployment = EntityValue<typeof deploymentEntity>
export type DeploymentInput = EntityInput<typeof deploymentEntity>
export type StatefulSet = EntityValue<typeof statefulSetEntity>
export type StatefulSetInput = EntityInput<typeof statefulSetEntity>
export type NetworkInterface = EntityValue<typeof networkInterfaceEntity>
export type NetworkInterfaceInput = EntityInput<typeof networkInterfaceEntity>
