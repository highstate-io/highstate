import type { ServiceAccount } from "../../../database"
import {
  commonObjectMetaSchema,
  objectMetaSchema,
  serviceAccountMetaSchema,
  z,
} from "@highstate/contract"
import { collectionQuerySchema } from "../base"

export const apiKeyMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
  })
  .required({ title: true })

export type ApiKeyMeta = z.infer<typeof apiKeyMetaSchema>

export const apiKeyOutputSchema = z.object({
  id: z.cuid2(),
  meta: commonObjectMetaSchema,
  serviceAccountId: z.cuid2(),
  serviceAccountMeta: serviceAccountMetaSchema.nullable(),
  createdAt: z.date(),
})

export type ApiKeyOutput = z.infer<typeof apiKeyOutputSchema>

export const apiKeyQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
})

export type ApiKeyQuery = z.infer<typeof apiKeyQuerySchema>

export function toApiKeyOutput(
  apiKey: Omit<ApiKeyOutput, "serviceAccountMeta">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
): ApiKeyOutput {
  return {
    ...apiKey,
    serviceAccountMeta: serviceAccount?.meta ?? null,
  }
}
