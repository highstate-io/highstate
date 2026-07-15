import { defineUnit, z } from "@highstate/contract"
import { implementationReferenceSchema } from "../impl-ref"
import { namespaceEntity } from "./resources"
import { clusterEntity } from "./shared"

const semverVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)

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

  /**
   * The nested implementation reference for the Gateway API controller.
   */
  controllerImplRef: implementationReferenceSchema.optional(),
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

  args: {
    /**
     * The Gateway API release channel to install.
     */
    channel: z.enum(["stable", "experimental"]).default("stable"),

    /**
     * The Gateway API version to install.
     *
     * Defaults to the latest stable version when using the stable channel.
     * Must be specified when using the experimental channel.
     */
    version: semverVersionSchema.optional(),
  },

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
