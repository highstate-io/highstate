import { $args, defineEntity, defineUnit, z } from "@highstate/contract"
import { serverEntity } from "../common"
import * as dns from "../dns"
import { implementationReferenceSchema } from "../impl-ref"
import { l3EndpointEntity, l4EndpointEntity } from "../network"
import { arrayPatchModeSchema } from "../utils"
import { scopedResourceSchema } from "./resources"

export const fallbackKubeApiAccessSchema = z.object({
  serverIp: z.string(),
  serverPort: z.number(),
})

export const tunDevicePolicySchema = z.union([
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
  tunDevicePolicy: tunDevicePolicySchema.optional(),

  /**
   * The service type to use for external services.
   *
   * If not provided, the default service type is `NodePort` since `LoadBalancer` may not be available.
   */
  externalServiceType: externalServiceTypeSchema.optional(),
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
   * The endpoints of the cluster nodes.
   *
   * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
   *
   * The same node may also be represented by multiple entries (e.g. a node with private and public IP).
   */
  endpoints: l3EndpointEntity.schema.array(),

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
  externalIps: z.string().array(),

  /**
   * The extra quirks of the cluster to improve compatibility.
   */
  quirks: clusterQuirksSchema.optional(),

  /**
   * The extra metadata to attach to the cluster.
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
} as const

export const clusterEntity = defineEntity({
  type: "k8s.cluster.v1",

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
  apiEndpoints: {
    entity: l4EndpointEntity,
    multiple: true,
  },
  endpoints: {
    entity: l3EndpointEntity,
    multiple: true,
  },
} as const

/**
 * The existing Kubernetes cluster created outside of the Highstate.
 */
export const existingCluster = defineUnit({
  type: "k8s.existing-cluster.v1",

  args: {
    /**
     * The list of external IPs of the cluster nodes allowed to be used for external access.
     *
     * If not provided, will be automatically detected by querying the cluster nodes.
     */
    externalIps: z.string().array().optional(),

    /**
     * The policy for using internal IPs of the nodes as external IPs.
     *
     * - `always`: always use internal IPs as external IPs;
     * - `public`: use internal IPs as external IPs only if they are (theoretically) routable from the public internet **(default)**;
     * - `never`: never use internal IPs as external IPs.
     */
    internalIpsPolicy: internalIpsPolicySchema.default("public"),

    /**
     * The extra quirks of the cluster to improve compatibility.
     */
    quirks: clusterQuirksSchema.optional(),
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
     * The endpoints of the API server.
     *
     * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
     *
     * The same node may also be represented by multiple entries (e.g. a node with private and public IP).
     */
    apiEndpoints: z.string().array().default([]),

    /**
     * The mode to use for patching the API endpoints.
     *
     * - `prepend`: prepend the new endpoints to the existing ones (default);
     * - `replace`: replace the existing endpoints with the new ones.
     */
    apiEndpointsPatchMode: arrayPatchModeSchema.default("prepend"),

    /**
     * The endpoints of the cluster nodes.
     *
     * The entry may represent real node endpoint or virtual endpoint (like a load balancer).
     *
     * The same node may also be represented by multiple entries (e.g. a node with private and public IP).
     */
    endpoints: z.string().array().default([]),

    /**
     * The mode to use for patching the endpoints.
     *
     * - `prepend`: prepend the new endpoints to the existing ones (default);
     * - `replace`: replace the existing endpoints with the new ones.
     */
    endpointsPatchMode: arrayPatchModeSchema.default("prepend"),
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

/**
 * Creates a set of DNS records for the cluster and updates the endpoints.
 */
export const clusterDns = defineUnit({
  type: "k8s.cluster-dns.v1",

  args: {
    ...dns.createArgs(),
    ...dns.createArgs("api"),
  },

  inputs: {
    k8sCluster: clusterEntity,
    ...dns.inputs,
  },

  outputs: clusterOutputs,

  meta: {
    title: "Cluster DNS",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:dns",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/cluster-dns",
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
  resources: scopedResourceSchema.array(),
})

export type Cluster = z.infer<typeof clusterEntity.schema>

export type InternalIpsPolicy = z.infer<typeof internalIpsPolicySchema>

export type MonitorWorkerParams = z.infer<typeof monitorWorkerParamsSchema>
export type MonitorWorkerResourceGroup = z.infer<typeof monitorWorkerResourceGroupSchema>
