import { serviceAccountMetaSchema, z } from "@highstate/contract"
import { collectionQuerySchema } from "../base"

export const serviceAccountOutputSchema = z.object({
  id: z.cuid2(),
  meta: serviceAccountMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type ServiceAccountOutput = z.infer<typeof serviceAccountOutputSchema>

export const serviceAccountQuerySchema = collectionQuerySchema.extend({
  artifactId: z.string().optional(),
})

export type ServiceAccountQuery = z.infer<typeof serviceAccountQuerySchema>
