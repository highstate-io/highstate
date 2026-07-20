import {
  defineEntity,
  defineUnit,
  type EntityInput,
  type EntityValue,
  secretSchema,
  z,
} from "@highstate/contract"
import { gatewayEntity } from "./common"
import { implementationReferenceSchema } from "./impl-ref"
import {
  clusterEntity,
  helmExtensionArgs,
  namespacedResourceEntity,
  namespaceEntity,
  schedulingArg,
  serviceEntity,
} from "./k8s"
import { l3EndpointEntity, l4EndpointEntity } from "./network"

const source = (path: string) => ({
  package: "@highstate/netaminity",
  path,
})

const portSchema = z.number().int().min(1).max(65535)
const serviceTypeSchema = z.enum(["ClusterIP", "NodePort", "LoadBalancer"])
const podTemplateSchema = z.record(z.string(), z.unknown()).default({})
const replicasSchema = z.number().int().min(1).default(1)
const oddReplicasSchema = z
  .number()
  .int()
  .min(1)
  .refine(replicas => replicas % 2 === 1, "Netaminity replicas must be odd")
  .default(1)

export const gatewayDataSchema = z.object({
  /**
   * The proxy-side gateway that accepts public TLS traffic.
   */
  proxyGateway: gatewayEntity.schema,

  /**
   * The target-side gateway that terminates TLS and routes requests.
   */
  targetGateway: gatewayEntity.schema,

  /**
   * The implementation reference used to create proxy-side TLS routes.
   */
  proxyImplRef: implementationReferenceSchema,

  /**
   * The implementation reference used to create target-side application routes.
   */
  targetImplRef: implementationReferenceSchema,

  /**
   * The TLS port exposed by the target-side gateway.
   */
  targetGatewayPort: portSchema,

  /**
   * The endpoints of the shared tunnel Service in the proxy cluster.
   */
  tunnelEndpoints: l4EndpointEntity.schema.array(),
})

export const proxyEntity = defineEntity({
  type: "netaminity.proxy.v1",

  extends: { namespacedResourceEntity },

  includes: {
    /**
     * The consumer Service created for the proxy.
     */
    service: {
      entity: serviceEntity,
      required: false,
    },
    /**
     * The endpoints where consumers can access the proxied service.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  schema: z.object({
    /**
     * The control endpoint where Netaminity targets connect to the proxy.
     */
    proxyEndpoint: z.string(),

    /**
     * The shared authentication secret used by the proxy and its targets.
     */
    sharedSecret: secretSchema(z.string()),
  }),

  meta: {
    color: "#477D75",
    title: "Netaminity Proxy",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#477D75",
    secondaryIcon: "mdi:connection",
  },
})

export const targetEntity = defineEntity({
  type: "netaminity.target.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#8064A2",
    title: "Netaminity Target",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#8064A2",
    secondaryIcon: "mdi:target",
  },
})

export const tunnelEntity = defineEntity({
  type: "netaminity.tunnel.v1",

  extends: { namespacedResourceEntity },

  includes: {
    /**
     * The consumer Service created for the tunnel.
     */
    service: serviceEntity,

    /**
     * The endpoints where consumers can access the tunnel.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#2878A0",
    title: "Netaminity Tunnel",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#2878A0",
    secondaryIcon: "bitcoin-icons:proxy-filled",
  },
})

/**
 * Installs the Netaminity operator on a Kubernetes cluster.
 */
export const operator = defineUnit({
  type: "netaminity.operator.v1",

  args: {
    ...helmExtensionArgs,
    ...schedulingArg,

    /**
     * The number of Netaminity operator replicas.
     *
     * Leader election ensures that only one replica actively reconciles resources.
     * The replica count must be odd.
     */
    replicas: oddReplicasSchema,

    /**
     * The hostname or IP address used to advertise NodePort proxy control Services.
     *
     * When omitted, the proxy host input or the first cluster endpoint is used.
     */
    proxyHost: z.string().optional(),
  },

  inputs: {
    /**
     * The Kubernetes cluster where the Netaminity operator should be installed.
     */
    k8sCluster: clusterEntity,

    /**
     * The hostname or IP address used to advertise NodePort proxy control Services.
     *
     * The first cluster endpoint is used when this input and the proxyHost argument are omitted.
     */
    proxyHost: {
      entity: l3EndpointEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The Kubernetes cluster after the Netaminity operator has been installed.
     */
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Netaminity Operator",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#2878A0",
    category: "Network",
  },

  source: source("operator"),
})

/**
 * Creates a Netaminity proxy on a Kubernetes cluster.
 */
export const proxy = defineUnit({
  type: "netaminity.proxy.v1",

  args: {
    /**
     * The name of the Proxy custom resource.
     *
     * If omitted, the unit name is used.
     */
    resourceName: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create for the proxy.
     *
     * Ignored when the namespace input is provided.
     */
    namespace: z.string().optional(),

    /**
     * Whether to create a Service for consumers of the proxied target.
     */
    serviceEnabled: z.boolean().default(true),

    /**
     * The name of the consumer Service.
     *
     * If omitted, the Proxy resource name is used.
     */
    serviceName: z.string().optional(),

    /**
     * The TCP port exposed by the consumer Service.
     *
     * When omitted, the port of the first endpoint input is used.
     */
    servicePort: portSchema.optional(),

    /**
     * Whether to expose the consumer Service outside the cluster.
     *
     * The Service type is selected automatically from the cluster configuration.
     */
    external: z.boolean().default(false),

    /**
     * The name of the control Service used by targets.
     */
    proxyServiceName: z.string().optional(),

    /**
     * The Kubernetes type of the control Service used by targets.
     */
    proxyServiceType: serviceTypeSchema.default("NodePort"),

    /**
     * The fixed NodePort for the control Service.
     *
     * Kubernetes assigns one when omitted.
     */
    proxyNodePort: portSchema.optional(),

    /**
     * The number of interchangeable proxy pods behind the Proxy Services.
     */
    replicas: replicasSchema,

    /**
     * Whether generated proxy pods use the node network namespace.
     */
    hostNetwork: z.boolean().default(false),

    /**
     * Whether generated proxy pods prefer distribution across Kubernetes nodes.
     */
    distributeByNodes: z.boolean().default(true),

    /**
     * The raw Netaminity pod template applied to the generated proxy pod.
     */
    podTemplate: podTemplateSchema,
  },

  secrets: {
    /**
     * The shared authentication secret used by the proxy and its targets.
     *
     * A random key is generated when omitted.
     */
    sharedSecret: z.string().optional(),
  },

  inputs: {
    /**
     * The Kubernetes cluster with the Netaminity operator installed.
     */
    k8sCluster: clusterEntity,

    /**
     * The target TCP endpoints whose port should be exposed by the consumer Service.
     *
     * The first endpoint's port is used when the servicePort argument is omitted.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where the proxy should be created.
     */
    namespace: {
      entity: namespaceEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The Netaminity proxy, including its control endpoint and shared secret.
     */
    proxy: proxyEntity,

    /**
     * The consumer Service created for the proxy.
     */
    service: {
      entity: serviceEntity,
      required: false,
    },
    /**
     * The endpoints where consumers can access the proxied service.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Netaminity Proxy",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#477D75",
    secondaryIcon: "mdi:connection",
    category: "Network",
  },

  source: source("proxy"),
})

/**
 * Creates a Netaminity target connected to a standalone proxy.
 */
export const target = defineUnit({
  type: "netaminity.target.v1",

  args: {
    /**
     * The name of the Target custom resource.
     *
     * If omitted, the unit name is used.
     */
    resourceName: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create for the target.
     *
     * Ignored when the namespace input is provided.
     */
    namespace: z.string().optional(),

    /**
     * The target TCP endpoint reachable from the generated target pod.
     *
     * When omitted, the first endpoint input is used.
     */
    endpoint: z.string().min(3).optional(),

    /**
     * Whether the generated target pod uses the node network namespace.
     */
    hostNetwork: z.boolean().default(false),

    /**
     * Whether the generated target pod prefers distribution across Kubernetes nodes.
     */
    distributeByNodes: z.boolean().default(true),

    /**
     * The raw Netaminity pod template applied to the generated target pod.
     */
    podTemplate: podTemplateSchema,
  },

  inputs: {
    /**
     * The Kubernetes cluster with the Netaminity operator installed.
     */
    k8sCluster: clusterEntity,

    /**
     * The standalone Netaminity proxy to connect the target to.
     */
    proxy: proxyEntity,

    /**
     * The target TCP endpoints reachable from the generated target pod.
     *
     * The first endpoint is used when the endpoint argument is omitted.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where the target should be created.
     */
    namespace: {
      entity: namespaceEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The created Netaminity target resource.
     */
    target: targetEntity,
  },

  meta: {
    title: "Netaminity Target",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#8064A2",
    secondaryIcon: "mdi:target",
    category: "Network",
  },

  source: source("target"),
})

/**
 * Creates a complete Netaminity tunnel within one Kubernetes cluster.
 */
export const tunnel = defineUnit({
  type: "netaminity.tunnel.v1",

  args: {
    /**
     * The name of the Tunnel custom resource.
     *
     * If omitted, the unit name is used.
     */
    resourceName: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create for the tunnel.
     *
     * Ignored when the namespace input is provided.
     */
    namespace: z.string().optional(),

    /**
     * The number of proxy and target pairs created for the tunnel.
     */
    replicas: replicasSchema,

    /**
     * The number of interchangeable proxy pods created for each Proxy resource.
     */
    proxyReplicas: replicasSchema,

    /**
     * Whether generated proxy and target pods use their node network namespace.
     */
    hostNetwork: z.boolean().default(false),

    /**
     * Whether generated proxy and target pods prefer distribution across Kubernetes nodes.
     */
    distributeByNodes: z.boolean().default(true),

    /**
     * The target TCP endpoint reachable from generated target pods.
     *
     * When omitted, the first endpoint input is used.
     */
    endpoint: z.string().min(3).optional(),

    /**
     * The name of the consumer Service.
     *
     * If omitted, the Tunnel resource name is used.
     */
    serviceName: z.string().optional(),

    /**
     * The TCP port exposed by the consumer Service.
     *
     * When omitted, the destination endpoint port is used.
     */
    servicePort: portSchema.optional(),

    /**
     * Whether to expose the consumer Service outside the cluster.
     *
     * The Service type is selected automatically from the cluster configuration.
     */
    external: z.boolean().default(false),

    /**
     * The Kubernetes type of the control Services used by generated targets.
     */
    proxyServiceType: serviceTypeSchema.default("NodePort"),

    /**
     * The first fixed NodePort assigned to generated proxy control Services.
     *
     * Replica indexes are added to this value.
     */
    proxyNodePort: portSchema.optional(),

    /**
     * The raw base pod template inherited by generated proxy and target pods.
     */
    podTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated proxy pods.
     */
    proxyPodTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated target pods.
     */
    targetPodTemplate: podTemplateSchema,
  },

  inputs: {
    /**
     * The Kubernetes cluster with the Netaminity operator installed.
     */
    k8sCluster: clusterEntity,

    /**
     * The target TCP endpoints reachable from generated target pods.
     *
     * The first endpoint is used when the endpoint argument is omitted.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where the tunnel should be created.
     */
    namespace: {
      entity: namespaceEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The created Netaminity tunnel resource.
     */
    tunnel: tunnelEntity,

    /**
     * The consumer Service created for the tunnel.
     */
    service: serviceEntity,

    /**
     * The endpoints where consumers can access the tunnel.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Netaminity Tunnel",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#2878A0",
    secondaryIcon: "bitcoin-icons:proxy-filled",
    category: "Network",
  },

  source: source("tunnel"),
})

/**
 * Creates a replicated Netaminity tunnel across two Kubernetes clusters.
 */
export const tunnelMc = defineUnit({
  type: "netaminity.tunnel.mc.v1",

  args: {
    /**
     * The base name of the generated Proxy and Target custom resources.
     *
     * If omitted, the unit name is used.
     */
    resourceName: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create in the proxy cluster.
     *
     * Ignored when the proxyNamespace input is provided.
     */
    proxyNamespace: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create in the target cluster.
     *
     * Ignored when the targetNamespace input is provided.
     */
    targetNamespace: z.string().optional(),

    /**
     * The number of Proxy and Target pairs created for the tunnel.
     */
    replicas: replicasSchema,

    /**
     * The number of interchangeable proxy pods created for each Proxy resource.
     */
    proxyReplicas: replicasSchema,

    /**
     * Whether generated Proxy and Target pods use their node network namespace.
     */
    hostNetwork: z.boolean().default(false),

    /**
     * Whether generated Proxy and Target pods prefer distribution across Kubernetes nodes.
     */
    distributeByNodes: z.boolean().default(true),

    /**
     * The target TCP endpoint reachable from generated Target pods.
     *
     * When omitted, the first endpoint input is used.
     */
    endpoint: z.string().min(3).optional(),

    /**
     * The name of the shared consumer Service in the proxy cluster.
     *
     * If omitted, the base resource name is used.
     */
    serviceName: z.string().optional(),

    /**
     * The TCP port exposed by the shared consumer Service.
     *
     * When omitted, the destination endpoint port is used.
     */
    servicePort: portSchema.optional(),

    /**
     * Whether to expose the shared consumer Service outside the proxy cluster.
     *
     * The Service type is selected automatically from the proxy cluster configuration.
     */
    external: z.boolean().default(false),

    /**
     * The Kubernetes type of the control Services used by generated Targets.
     */
    proxyServiceType: serviceTypeSchema.default("NodePort"),

    /**
     * The first fixed NodePort assigned to generated Proxy control Services.
     *
     * Replica indexes are added to this value.
     */
    proxyNodePort: portSchema.optional(),

    /**
     * The raw base pod template inherited by generated Proxy and Target pods.
     */
    podTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated Proxy pods.
     */
    proxyPodTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated Target pods.
     */
    targetPodTemplate: podTemplateSchema,
  },

  secrets: {
    /**
     * The shared authentication secret used by every generated Proxy and Target.
     *
     * A random key is generated when omitted.
     */
    sharedSecret: z.string().optional(),
  },

  inputs: {
    /**
     * The Kubernetes cluster where generated Proxies and the consumer Service are created.
     */
    proxyK8sCluster: clusterEntity,

    /**
     * The Kubernetes cluster where generated Targets are created.
     */
    targetK8sCluster: clusterEntity,

    /**
     * The target TCP endpoints reachable from generated Target pods.
     *
     * The first endpoint is used when the endpoint argument is omitted.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where Proxies and the consumer Service are created.
     */
    proxyNamespace: {
      entity: namespaceEntity,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where Targets are created.
     */
    targetNamespace: {
      entity: namespaceEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The shared consumer Service created in the proxy cluster.
     */
    service: serviceEntity,

    /**
     * The endpoints where consumers can access the multi-cluster tunnel.
     */
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Netaminity MC Tunnel",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#2878A0",
    secondaryIcon: "bitcoin-icons:proxy-filled",
    category: "Network",
  },

  source: source("tunnel.mc"),
})

/**
 * Wraps proxy-side and target-side gateways with one shared Netaminity tunnel.
 */
export const gateway = defineUnit({
  type: "netaminity.gateway.v1",

  args: {
    /**
     * The name of the generated Netaminity resources.
     *
     * If omitted, the unit name is used.
     */
    resourceName: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create in the proxy cluster.
     *
     * Ignored when the proxyNamespace input is provided.
     */
    proxyNamespace: z.string().optional(),

    /**
     * The name of the Kubernetes namespace to create in the target cluster.
     *
     * Ignored when the targetNamespace input is provided.
     */
    targetNamespace: z.string().optional(),

    /**
     * The number of Proxy and Target pairs created for the shared tunnel.
     */
    replicas: replicasSchema,

    /**
     * The number of interchangeable proxy pods created for each Proxy resource.
     */
    proxyReplicas: replicasSchema,

    /**
     * Whether generated Proxy and Target pods use their node network namespace.
     */
    hostNetwork: z.boolean().default(false),

    /**
     * Whether generated Proxy and Target pods prefer distribution across Kubernetes nodes.
     */
    distributeByNodes: z.boolean().default(true),

    /**
     * The TLS port exposed by the target-side gateway.
     */
    targetGatewayPort: portSchema.default(443),

    /**
     * The Kubernetes type of the control Services used by generated Targets.
     */
    proxyServiceType: serviceTypeSchema.default("NodePort"),

    /**
     * The first fixed NodePort assigned to generated Proxy control Services.
     *
     * Replica indexes are added to this value.
     */
    proxyNodePort: portSchema.optional(),

    /**
     * The raw base pod template inherited by generated Proxy and Target pods.
     */
    podTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated Proxy pods.
     */
    proxyPodTemplate: podTemplateSchema,

    /**
     * The raw pod template merged into generated Target pods.
     */
    targetPodTemplate: podTemplateSchema,
  },

  secrets: {
    /**
     * The shared authentication secret used by every generated Proxy and Target.
     *
     * A random key is generated when omitted.
     */
    sharedSecret: z.string().optional(),
  },

  inputs: {
    /**
     * The public gateway in the proxy cluster.
     */
    proxyGateway: gatewayEntity,

    /**
     * The local gateway in the target cluster.
     */
    targetGateway: gatewayEntity,

    /**
     * The operator-ready Kubernetes cluster where Proxy resources are created.
     */
    proxyK8sCluster: clusterEntity,

    /**
     * The operator-ready Kubernetes cluster where Target resources are created.
     */
    targetK8sCluster: clusterEntity,

    /**
     * The existing Kubernetes namespace where Proxy resources are created.
     */
    proxyNamespace: {
      entity: namespaceEntity,
      required: false,
    },

    /**
     * The existing Kubernetes namespace where Target resources are created.
     */
    targetNamespace: {
      entity: namespaceEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The gateway that delegates termination to the target cluster through Netaminity.
     */
    gateway: gatewayEntity,
  },

  meta: {
    title: "Netaminity Gateway",
    icon: "eos-icons:proxy-outlined",
    iconColor: "#2878A0",
    secondaryIcon: "bitcoin-icons:proxy-filled",
    category: "Network",
  },

  source: source("gateway"),
})

export type Proxy = EntityValue<typeof proxyEntity>
export type ProxyInput = EntityInput<typeof proxyEntity>
export type Target = EntityValue<typeof targetEntity>
export type TargetInput = EntityInput<typeof targetEntity>
export type Tunnel = EntityValue<typeof tunnelEntity>
export type TunnelInput = EntityInput<typeof tunnelEntity>
export type GatewayData = z.infer<typeof gatewayDataSchema>
