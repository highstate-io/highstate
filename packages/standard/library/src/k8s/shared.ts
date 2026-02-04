import { $args, defineEntity, defineUnit, type EntityInput, z } from "@highstate/contract"
import { serverEntity } from "../common"
import { implementationReferenceSchema } from "../impl-ref"
import { addressEntity, l3EndpointEntity, l4EndpointEntity } from "../network"
import { metadataSchema } from "../utils"
import { namespacedResourceEntity } from "./resources"

export const fallbackKubeApiAccessSchema = z.object({
  serverIp: z.string(),
  serverPort: z.number(),
})

export const tunDevicePolicySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host"),
  }),
  z.object({
    type: z.literal("plugin"),
    resourceName: z.string(),
    resourceValue: z.string(),
  }),
])

export const externalServiceTypeSchema = z.enum(["NodePort", "LoadBalancer"])
export const scheduleOnMastersPolicySchema = z.enum(["always", "when-no-workers", "never"])

export const clusterQuirksSchema = z.object({
  /**
   * The IP and port of the kube-apiserver available from the cluster.
   *
   * Will be used to create fallback network policy in CNIs which does not support allowing access to the kube-apiserver.
   */
  fallbackKubeApiAccess: fallbackKubeApiAccessSchema.optional(),

  /**
   * Specifies the policy for using the tun device inside containers.
   *
   * If not provided, the default policy is `host` which assumes just mounting /dev/net/tun from the host.
   *
   * For some runtimes, like Talos's one, the /dev/net/tun device is not available in the host, so the plugin policy should be used.
   */
  tunDevicePolicy: tunDevicePolicySchema.prefault({ type: "host" }),

  /**
   * The service type to use for external services.
   *
   * If not provided, the default service type is `NodePort` since `LoadBalancer` may not be available.
   */
  externalServiceType: externalServiceTypeSchema.default("NodePort"),
})

export const clusterInfoProperties = {
  /**
   * The unique identifier of the cluster.
   *
   * Should be defined as a `uid` of the `kube-system` namespace which is always present in the cluster.
   */
  id: z.string(),

  /**
   * The ID of the connection to the cluster.
   *
   * If not explicitly set, should be the same as the cluster ID.
   *
   * When reducing cluster access, the `uid` of the service account should be used instead.
   */
  connectionId: z.string(),

  /**
   * The name of the cluster.
   */
  name: z.string(),

  /**
   * The optional reference to the network policy implementation.
   *
   * If not provided, the native Kubernetes NetworkPolicy implementation will be used.
   */
  networkPolicyImplRef: implementationReferenceSchema.optional(),

  /**
   * The endpoints of the API server.
   *
   * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
   *
   * The same node may also be represented by multiple entries (e.g. a node with private and public IP).
   */
  apiEndpoints: l4EndpointEntity.schema.array(),

  /**
   * The external IPs of the cluster nodes allowed to be used for external access.
   */
  externalIps: addressEntity.schema.array(),

  /**
   * The extra quirks of the cluster to improve compatibility.
   */
  quirks: clusterQuirksSchema.optional(),

  /**
   * The extra metadata to attach to the cluster.
   */
  metadata: metadataSchema.optional(),
} as const

export const clusterEntity = defineEntity({
  type: "k8s.cluster.v1",

  includes: {
    /**
     * The endpoints of the cluster nodes.
     *
     * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
     *
     * The same node may also be represented by multiple entries (e.g. a node with private and public IP).
     */
    endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
    },
  },

  schema: z.object({
    ...clusterInfoProperties,
    kubeconfig: z.string(),
  }),

  meta: {
    color: "#2196F3",
  },
})

export const internalIpsPolicySchema = z.enum(["always", "public", "never"])

export const scheduleOnMastersPolicyArgs = $args({
  /**
   * The policy for scheduling workloads on master nodes.
   *
   * - `always`: always schedule workloads on master nodes regardless of the number of workers;
   * - `when-no-workers`: schedule workloads on master nodes only if there are no workers (default);
   * - `never`: never schedule workloads on master nodes.
   */
  scheduleOnMastersPolicy: scheduleOnMastersPolicySchema.default("when-no-workers"),
})

export const clusterInputs = {
  masters: {
    entity: serverEntity,
    multiple: true,
  },
  workers: {
    entity: serverEntity,
    multiple: true,
    required: false,
  },
} as const

export const clusterOutputs = {
  k8sCluster: clusterEntity,
} as const

/**
 * The existing Kubernetes cluster created outside of the Highstate.
 */
export const existingCluster = defineUnit({
  type: "k8s.existing-cluster.v1",

  args: {
    /**
     * Whether to auto-detect external IPs of the cluster nodes and merge them with the provided external IPs.
     */
    autoDetectExternalIps: z.boolean().default(true),

    /**
     * The policy for using internal IPs of the nodes as external IPs.
     *
     * - `always`: always use internal IPs as external IPs;
     * - `public`: use internal IPs as external IPs only if they are (theoretically) routable from the public internet **(default)**;
     * - `never`: never use internal IPs as external IPs.
     *
     * Have no effect if `autoDetectExternalIps` is `false`.
     */
    internalIpsPolicy: internalIpsPolicySchema.default("public"),

    /**
     * The list of external IPs of the cluster nodes allowed to be used for external access.
     */
    externalIps: z.string().array().default([]),

    /**
     * Whether to use all external IPs (auto-detected and provided) as endpoints of the cluster.
     *
     * Set to `false` if you want to manage endpoints manually.
     */
    useExternalIpsAsEndpoints: z.boolean().default(true),

    /**
     * The list of endpoints of the cluster nodes.
     */
    endpoints: z.string().array().default([]),

    /**
     * Whether to add endpoints from `kubeconfig` to the list of API endpoints.
     *
     * Set to `false` if you want to manage API endpoints manually.
     */
    useKubeconfigApiEndpoint: z.boolean().default(true),

    /**
     * The list of endpoints of the API server.
     */
    apiEndpoints: z.string().array().default([]),

    /**
     * The extra quirks of the cluster to improve compatibility.
     */
    quirks: clusterQuirksSchema.optional().meta({ complex: true }),
  },

  secrets: {
    /**
     * The kubeconfig of the cluster to use for connecting to the cluster.
     *
     * Will be available for all components using `cluster` output of this unit.
     */
    kubeconfig: z.record(z.string(), z.unknown()),
  },

  outputs: clusterOutputs,

  meta: {
    title: "Existing Cluster",
    icon: "devicon:kubernetes",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/existing-cluster",
  },
})

/**
 * Patches some properties of the cluster and outputs the updated cluster.
 */
export const clusterPatch = defineUnit({
  type: "k8s.cluster-patch.v1",

  args: {
    /**
     * The endpoints to set on the cluster.
     */
    endpoints: z.string().array().default([]),

    /**
     * The API endpoints to set on the cluster.
     */
    apiEndpoints: z.string().array().default([]),
  },

  inputs: {
    k8sCluster: clusterEntity,
    apiEndpoints: {
      entity: l4EndpointEntity,
      required: false,
      multiple: true,
    },
    endpoints: {
      entity: l3EndpointEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: clusterOutputs,

  meta: {
    title: "Cluster Patch",
    icon: "devicon:kubernetes",
    secondaryIcon: "fluent:patch-20-filled",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/cluster-patch",
  },
})

export const monitorWorkerResourceGroupSchema = z.object({
  type: z.enum(["deployment", "statefulset", "pod", "service"]),
  namespace: z.string(),
  names: z.string().array().optional(),
})

export const monitorWorkerParamsSchema = z.object({
  /**
   * The content of the kubeconfig to use for monitoring.
   */
  kubeconfig: z.string(),

  /**
   * The resources to monitor in the cluster.
   */
  resources: namespacedResourceEntity.schema.array(),
})

export type Cluster = z.infer<typeof clusterEntity.schema>
export type ClusterInput = EntityInput<typeof clusterEntity>

export type InternalIpsPolicy = z.infer<typeof internalIpsPolicySchema>

export type MonitorWorkerParams = z.infer<typeof monitorWorkerParamsSchema>
export type MonitorWorkerResourceGroup = z.infer<typeof monitorWorkerResourceGroupSchema>
