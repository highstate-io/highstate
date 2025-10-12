import { defineEntity, z } from "@highstate/contract"

/**
 * The generic metadata schema for Kubernetes resources.
 */
export const metadataSchema = z.object({
  name: z.string(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  uid: z.string(),
})

/**
 * The metadata schema for Kubernetes resources that are scoped to a namespace.
 *
 * It includes the namespace field.
 */
export const scopedMetadataSchema = z.object({
  ...metadataSchema.shape,
  namespace: z.string(),
})

/**
 * The base schema for Kubernetes resources.
 *
 * It includes the cluster ID and name, which are required for all Kubernetes resources.
 */
export const resourceSchema = z.object({
  clusterId: z.string(),
  clusterName: z.string(),
  type: z.string(),
  metadata: metadataSchema,
})

/**
 * The schema for Kubernetes resources that are scoped to a namespace.
 *
 * Extends the base resource schema with the scoped metadata.
 */
export const scopedResourceSchema = z.object({
  ...resourceSchema.shape,
  metadata: scopedMetadataSchema,
})

/**
 * The entity which represents a Kubernetes namespace managed by Highstate.
 */
export const namespaceEntity = defineEntity({
  type: "k8s.namespace.v1",

  schema: z.object({
    ...resourceSchema.shape,
    type: z.literal("namespace"),
  }),

  meta: {
    color: "#9E9E9E",
  },
})

/**
 * The entity which represents a Kubernetes persistent volume claim managed by Highstate.
 */
export const persistentVolumeClaimEntity = defineEntity({
  type: "k8s.persistent-volume-claim.v1",

  schema: z.object({
    ...scopedResourceSchema.shape,
    type: z.literal("persistent-volume-claim"),
  }),

  meta: {
    color: "#FFC107",
  },
})

/**
 * The entity which represents a Gateway resource from the Gateway API.
 */
export const gatewayEntity = defineEntity({
  type: "k8s.gateway.v1",

  schema: z.object({
    ...scopedResourceSchema.shape,
    type: z.literal("gateway"),
  }),

  meta: {
    color: "#4CAF50",
  },
})

export const certificateEntity = defineEntity({
  type: "k8s.certificate.v1",

  schema: z.object({
    ...scopedResourceSchema.shape,
    type: z.literal("certificate"),
  }),
})

export type Metadata = z.infer<typeof metadataSchema>
export type Resource = z.infer<typeof resourceSchema>

export type ScopedMetadata = z.infer<typeof scopedMetadataSchema>
export type ScopedResource = z.infer<typeof scopedResourceSchema>

export type Namespace = z.infer<typeof namespaceEntity.schema>
export type PersistentVolumeClaim = z.infer<typeof persistentVolumeClaimEntity.schema>
export type Gateway = z.infer<typeof gatewayEntity.schema>
export type Certificate = z.infer<typeof certificateEntity.schema>
