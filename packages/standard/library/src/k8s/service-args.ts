import { $args, z } from "@highstate/contract"

export const managedFieldsEntrySchema = z.object({
  apiVersion: z.string().optional(),
  fieldsType: z.string().optional(),
  fieldsV1: z.unknown().optional(),
  manager: z.string().optional(),
  operation: z.string().optional(),
  subresource: z.string().optional(),
  time: z.string().optional(),
})

export const ownerReferenceSchema = z.object({
  apiVersion: z.string(),
  blockOwnerDeletion: z.boolean().optional(),
  controller: z.boolean().optional(),
  kind: z.string(),
  name: z.string(),
  uid: z.string(),
})

export const objectMetaSchema = z.object({
  annotations: z.record(z.string(), z.string()).optional(),
  creationTimestamp: z.string().optional(),
  deletionGracePeriodSeconds: z.number().optional(),
  deletionTimestamp: z.string().optional(),
  finalizers: z.string().array().optional(),
  generateName: z.string().optional(),
  generation: z.number().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  managedFields: managedFieldsEntrySchema.array().optional(),
  name: z.string().optional(),
  namespace: z.string().optional(),
  ownerReferences: ownerReferenceSchema.array().optional(),
  resourceVersion: z.string().optional(),
  selfLink: z.string().optional(),
  uid: z.string().optional(),
})

export const servicePortSchema = z.object({
  appProtocol: z.string().optional(),
  name: z.string().optional(),
  nodePort: z.number().optional(),
  port: z.number(),
  protocol: z.enum(["SCTP", "TCP", "UDP"]).optional(),
  targetPort: z.union([z.number(), z.string()]).optional(),
})

export const sessionAffinityConfigSchema = z.object({
  clientIP: z
    .object({
      timeoutSeconds: z.number().optional(),
    })
    .optional(),
})

export const serviceArgsSchema = z.object({
  /**
   * The name of the service.
   */
  name: z.string().optional(),

  /**
   * The metadata to apply to the service.
   */
  metadata: objectMetaSchema.optional(),

  /**
   * The port to expose the service on.
   */
  port: servicePortSchema.optional(),

  /**
   * Whether the service should be exposed by NodePort or LoadBalancer.
   */
  external: z.boolean().optional(),

  allocateLoadBalancerNodePorts: z.boolean().optional(),
  clusterIP: z.string().optional(),
  clusterIPs: z.string().array().optional(),
  externalIPs: z.string().array().optional(),
  externalName: z.string().optional(),
  externalTrafficPolicy: z.enum(["Cluster", "Local"]).optional(),
  healthCheckNodePort: z.number().optional(),
  internalTrafficPolicy: z.enum(["Cluster", "Local"]).optional(),
  ipFamilies: z.enum(["IPv4", "IPv6"]).array().optional(),
  ipFamilyPolicy: z.enum(["PreferDualStack", "RequireDualStack", "SingleStack"]).optional(),
  loadBalancerClass: z.string().optional(),
  loadBalancerIP: z.string().optional(),
  loadBalancerSourceRanges: z.string().array().optional(),
  ports: servicePortSchema.array().optional(),
  publishNotReadyAddresses: z.boolean().optional(),
  selector: z.record(z.string(), z.string()).optional(),
  sessionAffinity: z.enum(["ClientIP", "None"]).optional(),
  sessionAffinityConfig: sessionAffinityConfigSchema.optional(),
  trafficDistribution: z.string().optional(),
  type: z.enum(["ClusterIP", "ExternalName", "LoadBalancer", "NodePort"]).optional(),
})

export const serviceArg = $args({
  /**
   * The extra arguments to apply to the component service.
   *
   * Accepts Kubernetes Service spec fields and Highstate service helper arguments.
   */
  service: serviceArgsSchema.default({}).meta({ complex: true }),
})

export type ServiceArgs = z.infer<typeof serviceArgsSchema>
