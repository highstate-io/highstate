import type { ServiceAccount } from "../../../database"
import {
  commonObjectMetaSchema,
  objectMetaSchema,
  serviceAccountMetaSchema,
  z,
} from "@highstate/contract"
import { collectionQuerySchema } from "../base"
import { projectRoleRulesSchema } from "./role"

export const apiKeyMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
  })
  .required({ title: true })

export type ApiKeyMeta = z.infer<typeof apiKeyMetaSchema>

export const apiKeyRestrictionRulesSchema = projectRoleRulesSchema.or(z.tuple([]))

export const apiKeyInputSchema = z.object({
  meta: apiKeyMetaSchema,
  serviceAccountId: z.cuid2().optional(),
  restrictionRules: apiKeyRestrictionRulesSchema,
  expiresAt: z.date().nullable(),
})

export type ApiKeyInput = z.infer<typeof apiKeyInputSchema>

export const apiKeyOutputSchema = z.object({
  id: z.cuid2(),
  meta: commonObjectMetaSchema,
  serviceAccountId: z.cuid2(),
  serviceAccountMeta: serviceAccountMetaSchema.nullable(),
  restrictionRules: apiKeyRestrictionRulesSchema,
  expiresAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  managed: z.boolean(),
})

export type ApiKeyOutput = z.infer<typeof apiKeyOutputSchema>

export const apiKeyQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.string().optional(),
})

export type ApiKeyQuery = z.infer<typeof apiKeyQuerySchema>

export const apiKeyTokenOutputSchema = z.object({
  apiKey: apiKeyOutputSchema,
  token: z.string().min(1),
})

export type ApiKeyTokenOutput = z.infer<typeof apiKeyTokenOutputSchema>

export function toApiKeyOutput(
  apiKey: Omit<ApiKeyOutput, "serviceAccountMeta" | "managed">,
  serviceAccount?: Pick<ServiceAccount, "meta"> | null,
  managed = false,
): ApiKeyOutput {
  return {
    ...apiKey,
    serviceAccountMeta: serviceAccount?.meta ?? null,
    managed,
  }
}
