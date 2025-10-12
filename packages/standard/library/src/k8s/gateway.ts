import { defineUnit, z } from "@highstate/contract"
import { namespaceEntity } from "./resources"
import { clusterEntity } from "./shared"

export const gatewayDataSchema = z.object({
  /**
   * The Kubernetes cluster to use for creating gateway routes.
   */
  cluster: clusterEntity.schema,

  /**
   * The namespace where the gateway controller of the class is running.
   */
  namespace: namespaceEntity.schema,

  /**
   * The name of the gateway class to use.
   */
  className: z.string(),

  /**
   * The port to use for HTTP in listener.
   *
   * If not provided, defaults to 80.
   */
  httpPort: z.number().default(80),

  /**
   * The port to use for HTTPS in listener.
   *
   * If not provided, defaults to 443.
   */
  httpsPort: z.number().default(443),
})

export const gatewayImplRefSchema = z.object({
  package: z.literal("@highstate/k8s"),
  data: gatewayDataSchema,
})

/**
 * Installs the Gateway API CRDs to the cluster.
 */
export const gatewayApi = defineUnit({
  type: "k8s.gateway-api.v1",

  inputs: {
    k8sCluster: clusterEntity,
  },

  outputs: {
    k8sCluster: clusterEntity,
  },

  meta: {
    title: "Gateway API",
    icon: "devicon:kubernetes",
    secondaryIcon: "mdi:api",
    secondaryIconColor: "#4CAF50",
    category: "Kubernetes",
  },

  source: {
    package: "@highstate/k8s",
    path: "units/gateway-api",
  },
})

export type GatewayData = z.infer<typeof gatewayDataSchema>
export type GatewayImplRef = z.infer<typeof gatewayImplRefSchema>
