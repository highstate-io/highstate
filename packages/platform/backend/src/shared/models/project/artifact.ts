import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

export const artifactOutputSchema = z.object({
  id: z.cuid2(),
  hash: z.string(),
  size: z.number(),
  meta: commonObjectMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type ArtifactOutput = z.infer<typeof artifactOutputSchema>

export const artifactQuerySchema = collectionQuerySchema.extend({
  stateId: z.string().optional(),
  serviceAccountId: z.string().optional(),
  terminalId: z.string().optional(),
  pageId: z.string().optional(),
})

export type ArtifactQuery = z.infer<typeof artifactQuerySchema>
