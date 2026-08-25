import { genericNameSchema, serviceAccountMetaSchema, z } from "@highstate/contract"
import { collectionQuerySchema } from "../base"

export const serviceAccountInputSchema = z.object({
  meta: serviceAccountMetaSchema,
})

export const serviceAccountOutputSchema = serviceAccountInputSchema.extend({
  id: z.cuid2(),
  meta: serviceAccountMetaSchema,
  systemName: genericNameSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type ServiceAccountOutput = z.infer<typeof serviceAccountOutputSchema>
export type ServiceAccountInput = z.infer<typeof serviceAccountInputSchema>

export const serviceAccountQuerySchema = collectionQuerySchema.extend({
  artifactId: z.string().optional(),
})

export type ServiceAccountQuery = z.infer<typeof serviceAccountQuerySchema>
