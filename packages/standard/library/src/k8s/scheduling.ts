import { $args, z } from "@highstate/contract"

export const labelSelectorRequirementSchema = z.object({
  key: z.string(),
  operator: z.enum(["DoesNotExist", "Exists", "In", "NotIn"]),
  values: z.string().array().optional(),
})

export const labelSelectorSchema = z.object({
  matchExpressions: labelSelectorRequirementSchema.array().optional(),
  matchLabels: z.record(z.string(), z.string()).optional(),
})

export const nodeSelectorRequirementSchema = z.object({
  key: z.string(),
  operator: z.enum(["DoesNotExist", "Exists", "Gt", "In", "Lt", "NotIn"]),
  values: z.string().array().optional(),
})

export const nodeSelectorTermSchema = z.object({
  matchExpressions: nodeSelectorRequirementSchema.array().optional(),
  matchFields: nodeSelectorRequirementSchema.array().optional(),
})

export const nodeAffinitySchema = z.object({
  preferredDuringSchedulingIgnoredDuringExecution: z
    .object({
      preference: nodeSelectorTermSchema,
      weight: z.number(),
    })
    .array()
    .optional(),
  requiredDuringSchedulingIgnoredDuringExecution: z
    .object({
      nodeSelectorTerms: nodeSelectorTermSchema.array(),
    })
    .optional(),
})

export const podAffinityTermSchema = z.object({
  labelSelector: labelSelectorSchema.optional(),
  matchLabelKeys: z.string().array().optional(),
  mismatchLabelKeys: z.string().array().optional(),
  namespaceSelector: labelSelectorSchema.optional(),
  namespaces: z.string().array().optional(),
  topologyKey: z.string(),
})

export const podAffinitySchema = z.object({
  preferredDuringSchedulingIgnoredDuringExecution: z
    .object({
      podAffinityTerm: podAffinityTermSchema,
      weight: z.number(),
    })
    .array()
    .optional(),
  requiredDuringSchedulingIgnoredDuringExecution: podAffinityTermSchema.array().optional(),
})

export const affinitySchema = z.object({
  nodeAffinity: nodeAffinitySchema.optional(),
  podAffinity: podAffinitySchema.optional(),
  podAntiAffinity: podAffinitySchema.optional(),
})

export const tolerationSchema = z.object({
  effect: z.enum(["NoExecute", "NoSchedule", "PreferNoSchedule"]).optional(),
  key: z.string().optional(),
  operator: z.enum(["Equal", "Exists"]).optional(),
  tolerationSeconds: z.number().optional(),
  value: z.string().optional(),
})

export const schedulingSchema = z.object({
  affinity: affinitySchema.optional(),
  nodeSelector: z.record(z.string(), z.string()).optional(),
  tolerations: tolerationSchema.array().optional(),
})

export const schedulingArg = $args({
  /**
   * The Kubernetes scheduling options to apply to every pod created by the unit.
   */
  scheduling: schedulingSchema.default({}).meta({ complex: true }),
})

export type Scheduling = z.infer<typeof schedulingSchema>
