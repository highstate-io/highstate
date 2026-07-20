import { defineEntity, defineUnit, type EntityValue, secretSchema, z } from "@highstate/contract"
import { serverEntity } from "./common"
import { clusterInputs, clusterOutputs } from "./k8s/shared"
import { l4EndpointEntity } from "./network"

export const packagedComponents = [
  "coredns",
  "servicelb",
  "traefik",
  "local-storage",
  "metrics-server",
  "runtimes",
] as const

export const internalComponents = [
  "scheduler",
  "cloud-controller",
  "kube-proxy",
  "network-policy",
  "helm-controller",
] as const

export const componentSchema = z.enum([...packagedComponents, ...internalComponents])

export const cniSchema = z.enum(["none", "flannel"])

export const clusterEntity = defineEntity({
  type: "k3s.cluster.v1",

  includes: {
    /**
     * The API endpoint workers should use to join the cluster.
     *
     * This is the public endpoint when the cluster has one, otherwise the first master endpoint.
     */
    bootstrapEndpoint: l4EndpointEntity,
  },

  schema: z.object({
    /**
     * The cluster name.
     */
    name: z.string(),

    /**
     * The agent token workers should use to join the cluster.
     */
    agentToken: secretSchema(z.string()),

    /**
     * The shared K3s agent configuration for workers joining the cluster.
     */
    agentConfig: z.record(z.string(), z.unknown()),

    /**
     * The registry configuration workers should use when joining the cluster.
     */
    registries: z.record(z.string(), z.unknown()),
  }),

  meta: {
    color: "#326CE5",
    title: "K3s Cluster",
    icon: "devicon:k3s",
    iconColor: "#326CE5",
  },
})

/**
 * The K3s cluster created on top of the server.
 */
export const cluster = defineUnit({
  type: "k3s.cluster.v1",

  args: {
    /**
     * The components to disable in the K3S cluster.
     */
    disabledComponents: componentSchema.array().default([]),

    /**
     * The CNI to use in the K3S cluster.
     *
     * Setting this to "none" will disable default Flannel CNI, but will not disable network policy controller and kube-proxy.
     * If needed, you can disable them using `disabledComponents` argument.
     */
    cni: cniSchema.default("flannel"),

    /**
     * The K3S configuration to pass to each server or agent in the cluster.
     *
     * See: https://docs.k3s.io/installation/configuration
     */
    config: z.record(z.string(), z.unknown()).optional(),

    /**
     * The K3S configuration to pass to each server in the cluster.
     *
     * See: https://docs.k3s.io/installation/configuration
     */
    serverConfig: z.record(z.string(), z.unknown()).optional(),

    /**
     * The K3S configuration to pass to each agent in the cluster.
     *
     * See: https://docs.k3s.io/installation/configuration
     */
    agentConfig: z.record(z.string(), z.unknown()).optional(),

    /**
     * The map of configuration per each node in the cluster, where the key is the hostname of the node.
     *
     * Note: if multiple nodes have the same hostname, the configuration will be applied to all of them.
     */
    nodeConfig: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),

    /**
     * The configuration of the registries to use for the K3S cluster.
     *
     * See: https://docs.k3s.io/installation/private-registry
     */
    registries: z.record(z.string(), z.unknown()).optional(),
  },

  inputs: {
    ...clusterInputs,

    /**
     * The public API endpoint to expose for cluster access.
     *
     * If specified, it will be used for the kubeconfig, Kubernetes provider, cluster entity, and TLS SANs.
     * Node bootstrap still uses the first master endpoint.
     */
    publicEndpoint: {
      entity: l4EndpointEntity,
      required: false,
    },
  },
  outputs: {
    ...clusterOutputs,

    /**
     * The K3s cluster join information for provisioning additional workers.
     */
    cluster: clusterEntity,
  },

  meta: {
    title: "K3s Cluster",
    category: "k3s",
    icon: "devicon:k3s",
    secondaryIcon: "devicon:kubernetes",
  },

  source: {
    package: "@highstate/k3s",
    path: "cluster",
  },
})

/**
 * The group of K3s worker nodes joined to an existing K3s cluster.
 */
export const workerGroup = defineUnit({
  type: "k3s.worker-group.v1",

  args: {
    /**
     * The K3s configuration to pass to each worker in the group.
     *
     * See: https://docs.k3s.io/installation/configuration
     */
    config: z.record(z.string(), z.unknown()).optional(),

    /**
     * The map of configuration per each worker in the group, where the key is the hostname of the node.
     *
     * Note: if multiple nodes have the same hostname, the configuration will be applied to all of them.
     */
    nodeConfig: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  },

  inputs: {
    /**
     * The K3s cluster join information.
     */
    cluster: clusterEntity,

    /**
     * The worker servers in the group to join to the cluster.
     */
    workers: {
      entity: serverEntity,
      multiple: true,
    },
  },

  outputs: {
    /**
     * The worker servers in the group joined to the cluster.
     */
    workers: {
      entity: serverEntity,
      multiple: true,
    },
  },

  meta: {
    title: "K3s Worker Group",
    category: "k3s",
    icon: "devicon:k3s",
    secondaryIcon: "mdi:server",
  },

  source: {
    package: "@highstate/k3s",
    path: "worker-group",
  },
})

export type Cluster = EntityValue<typeof clusterEntity>
