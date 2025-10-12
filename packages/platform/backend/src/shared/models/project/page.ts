import type { ServiceAccount } from "../../../database"
import {
  commonObjectMetaSchema,
  pageBlockSchema,
  serviceAccountMetaSchema,
} from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

export const pageOutputSchema = z.object({
  id: z.cuid2(),
  meta: commonObjectMetaSchema,
  name: z.string().nullable(),
  stateId: z.cuid2().nullable(),
  serviceAccountId: z.cuid2().nullable(),
  serviceAccountMeta: serviceAccountMetaSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type PageOutput = z.infer<typeof pageOutputSchema>

export const pageQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
  stateId: z.string().optional(),
  artifactId: z.string().optional(),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

export const pageDetailsOutputSchema = z.object({
  ...pageOutputSchema.shape,
  content: z.array(pageBlockSchema),
})

export type PageDetailsOutput = z.infer<typeof pageDetailsOutputSchema>

export function toPageOutput(
  page: Omit<PageOutput, "serviceAccountMeta">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
): PageOutput {
  return {
    ...page,
    serviceAccountMeta: serviceAccount?.meta ?? null,
  }
}
