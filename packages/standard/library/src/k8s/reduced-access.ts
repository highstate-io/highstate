import { defineUnit, z } from "@highstate/contract"
import { certificateEntity, namespaceEntity, persistentVolumeClaimEntity } from "./resources"
import { serviceEntity } from "./service"
import { clusterEntity } from "./shared"
import { deploymentEntity, statefulSetEntity } from "./workload"

const k8sVerbsSchema = z.enum([
  "get",
  "list",
  "watch",
  "create",
  "update",
  "patch",
  "delete",
  "deletecollection",
])

/**
 * Creates a reduced access cluster with ServiceAccount-based authentication for specific Kubernetes resources.
 */
export const reducedAccessCluster = defineUnit({
  type: "k8s.reduced-access-cluster.v0",

  args: {
    /**
     * The verbs to allow on the specified resources.
     *
     * Defaults to read-only access (get, list, watch).
     */
    verbs: k8sVerbsSchema.array().default(["get", "list", "watch"]),

    /**
     * The name of the ServiceAccount to create.
     *
     * If not provided, will be the same as the unit name.
     */
    serviceAccountName: z.string().optional(),
  },

  inputs: {
    k8sCluster: clusterEntity,

    /**
     * The namespace where the ServiceAccount will be created.
     */
    namespace: namespaceEntity,

    /**
     * The deployments to grant access to.
     */
    deployments: {
      entity: deploymentEntity,
      multiple: true,
      required: false,
    },

    /**
     * The stateful sets to grant access to.
     */
    statefulSets: {
      entity: statefulSetEntity,
      multiple: true,
      required: false,
    },

    /**
     * The services to grant access to.
     */
    services: {
      entity: serviceEntity,
      multiple: true,
      required: false,
    },

    /**
     * The persistent volume claims to grant access to.
     */
    persistentVolumeClaims: {
      entity: persistentVolumeClaimEntity,
      multiple: true,
      required: false,
    },

    /**
     * The secrets to grant access to.
     */
    secrets: {
      entity: certificateEntity,
      multiple: true,
      required: false,
    },

    /**
     * The config maps to grant access to.
     */
    configMaps: {
      entity: certificateEntity,
      multiple: true,
      required: false,
    },
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Reduced Access Cluster",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:shield-lock",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/reduced-access-cluster",
  },
})
