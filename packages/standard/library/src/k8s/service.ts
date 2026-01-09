import { defineEntity, z } from "@highstate/contract"
import { l4EndpointEntity } from "../network"
import { namespacedResourceEntity } from "./resources"

export const endpointServiceMetadataSchema = z.object({
  "k8s.service": z.object({
    /**
     * The ID of the cluster where the service is located.
     */
    clusterId: z.string(),

    /**
     * The name of the cluster where the service is located.
     */
    clusterName: z.string(),

    /**
     * The name of the service.
     */
    name: z.string(),

    /**
     * The namespace of the service.
     */
    namespace: z.string(),

    /**
     * The selector of the service.
     */
    selector: z.record(z.string(), z.string()),

    /**
     * The target port of the service.
     */
    targetPort: z.union([z.string(), z.number()]),
  }),
})

export const serviceEndpointSchema = z.intersection(
  l4EndpointEntity.schema,
  z.object({
    metadata: endpointServiceMetadataSchema,
  }),
)

export const serviceEntity = defineEntity({
  type: "k8s.service.v1",

  extends: { namespacedResourceEntity },

  includes: {
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  schema: z.unknown(),

  meta: {
    color: "#2196F3",
  },
})

export const serviceTypeSchema = z.enum(["NodePort", "LoadBalancer", "ClusterIP"])

export type EndpointServiceMetadata = z.infer<typeof endpointServiceMetadataSchema>
export type ServiceEndpoint = z.infer<typeof serviceEndpointSchema>
export type ServiceType = z.infer<typeof serviceTypeSchema>
export type Service = z.infer<typeof serviceEntity.schema>
