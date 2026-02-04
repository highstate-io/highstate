import type { Simplify, SimplifyDeep } from "type-fest"
import { defineEntity, type EntityInput, z } from "@highstate/contract"

/**
 * The generic metadata schema for Kubernetes resources.
 */
export const metadataSchema = z.object({
  name: z.string(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  uid: z.string(),
  namespace: z.string().optional(),
})

/**
 * The metadata schema for Kubernetes resources that are scoped to a namespace.
 *
 * It includes the namespace field.
 */
export const namespacedMetadataSchema = z.object({
  ...metadataSchema.shape,
  namespace: z.string(),
})

/**
 * The entity which represents a Kubernetes resource.
 */
export const resourceEntity = defineEntity({
  type: "k8s.resource.v1",

  schema: z.intersection(
    z.object({
      clusterId: z.string(),
      clusterName: z.string(),
      apiVersion: z.string(),
      kind: z.string(),
    }),
    z.union([
      z.object({
        isNamespaced: z.literal(false),
        metadata: metadataSchema,
      }),
      z.object({
        isNamespaced: z.literal(true),
        metadata: namespacedMetadataSchema,
      }),
    ]),
  ),
})

/**
 * The entity which represents a Kubernetes resource scoped to a namespace.
 */
export const namespacedResourceEntity = defineEntity({
  type: "k8s.namespaced-resource.v1",

  extends: { resourceEntity },

  schema: z.object({
    isNamespaced: z.literal(true),
  }),
})

/**
 * The entity which represents a Kubernetes namespace managed by Highstate.
 */
export const namespaceEntity = defineEntity({
  type: "k8s.namespace.v1",

  extends: { resourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#9E9E9E",
  },
})

/**
 * The entity which represents a Kubernetes persistent volume claim managed by Highstate.
 */
export const persistentVolumeClaimEntity = defineEntity({
  type: "k8s.persistent-volume-claim.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#FFC107",
  },
})

/**
 * The entity which represents a Gateway resource from the Gateway API.
 */
export const gatewayEntity = defineEntity({
  type: "k8s.gateway.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#4CAF50",
  },
})

export const certificateEntity = defineEntity({
  type: "k8s.certificate.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#3F51B5",
  },
})

export const configMapEntity = defineEntity({
  type: "k8s.config-map.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#FF9800",
  },
})

export const secretEntity = defineEntity({
  type: "k8s.secret.v1",

  extends: { namespacedResourceEntity },
  schema: z.unknown(),

  meta: {
    color: "#9C27B0",
  },
})

export type Metadata = z.infer<typeof metadataSchema>
export type Resource = z.infer<typeof resourceEntity.schema>
export type ResourceInput = EntityInput<typeof resourceEntity>

export type NamespacedMetadata = z.infer<typeof namespacedMetadataSchema>

export type NamespacedResource = SimplifyDeep<
  z.infer<typeof namespacedResourceEntity.schema>,
  Record<string, string>
>

export type NamespacedResourceInput = EntityInput<typeof namespacedResourceEntity>

export type Namespace = Simplify<z.infer<typeof namespaceEntity.schema>>
export type NamespaceInput = EntityInput<typeof namespaceEntity>
export type PersistentVolumeClaim = z.infer<typeof persistentVolumeClaimEntity.schema>
export type PersistentVolumeClaimInput = EntityInput<typeof persistentVolumeClaimEntity>
export type Gateway = z.infer<typeof gatewayEntity.schema>
export type GatewayInput = EntityInput<typeof gatewayEntity>
export type Certificate = z.infer<typeof certificateEntity.schema>
export type CertificateInput = EntityInput<typeof certificateEntity>
export type ConfigMap = z.infer<typeof configMapEntity.schema>
export type ConfigMapInput = EntityInput<typeof configMapEntity>
export type Secret = z.infer<typeof secretEntity.schema>
export type SecretInput = EntityInput<typeof secretEntity>
