import {
  commonObjectMetaSchema,
  genericNameSchema,
  serviceAccountMetaSchema,
  timestampsSchema,
  z,
} from "@highstate/contract"
import { collectionQuerySchema } from "../base"
import { backendRoleRulesSchema } from "./role"

export const backendApiKeyRestrictionRulesSchema = backendRoleRulesSchema.or(z.tuple([]))

export const backendApiKeyInputSchema = z.object({
  meta: commonObjectMetaSchema.extend({ title: z.string().trim().min(1) }),
  serviceAccountId: z.cuid2().optional(),
  restrictionRules: backendApiKeyRestrictionRulesSchema,
  expiresAt: z.date().nullable(),
})

export const backendApiKeyOutputSchema = backendApiKeyInputSchema
  .required({ serviceAccountId: true })
  .extend({
    id: z.cuid2(),
    serviceAccountMeta: serviceAccountMetaSchema,
    lastUsedAt: z.date().nullable(),
    ...timestampsSchema.shape,
  })

export const backendApiKeyQuerySchema = collectionQuerySchema.extend({
  serviceAccountId: z.cuid2().optional(),
})

export const backendApiKeyTokenOutputSchema = z.object({
  apiKey: backendApiKeyOutputSchema,
  token: z.string().min(1),
})

export const backendRoleInputSchema = z.object({
  meta: commonObjectMetaSchema.extend({ title: z.string().trim().min(1) }),
  rules: backendRoleRulesSchema,
})

export const backendRoleOutputSchema = backendRoleInputSchema.extend({
  id: z.cuid2(),
  systemName: genericNameSchema.nullable(),
  ...timestampsSchema.shape,
})

export const backendRoleQuerySchema = collectionQuerySchema

export const backendServiceAccountInputSchema = z.object({
  meta: serviceAccountMetaSchema,
})

export const backendServiceAccountOutputSchema = backendServiceAccountInputSchema.extend({
  id: z.cuid2(),
  systemName: genericNameSchema.nullable(),
  ...timestampsSchema.shape,
})

export const backendServiceAccountQuerySchema = collectionQuerySchema

export const backendApiKeyServiceAccountOptionSchema = backendServiceAccountOutputSchema.extend({
  rules: z.array(backendRoleRulesSchema.element),
})

export const serviceAccountBackendRoleBindingOutputSchema = z.object({
  roleId: z.cuid2(),
  serviceAccountId: z.cuid2(),
  createdAt: z.date(),
})

export const backendServiceAccountProjectBindingOutputSchema = z.object({
  backendServiceAccountId: z.cuid2(),
  projectId: z.cuid2(),
  projectServiceAccountId: z.cuid2(),
  createdAt: z.date(),
})

export const backendProjectServiceAccountOptionSchema = z.object({
  projectId: z.cuid2(),
  projectMeta: commonObjectMetaSchema,
  unlocked: z.boolean(),
  serviceAccounts: z.array(
    z.object({
      id: z.cuid2(),
      meta: serviceAccountMetaSchema,
      systemName: genericNameSchema.nullable(),
    }),
  ),
  binding: backendServiceAccountProjectBindingOutputSchema.nullable(),
})

export const backendRoleRestrictionOptionSchema = z.object({
  id: z.string().min(1),
  meta: commonObjectMetaSchema,
})

export const backendRoleRestrictionOptionsSchema = z.object({
  resources: z.record(z.string(), z.array(backendRoleRestrictionOptionSchema)),
  projects: z.array(backendRoleRestrictionOptionSchema),
  projectSpaces: z.array(backendRoleRestrictionOptionSchema),
})

export type BackendRoleInput = z.infer<typeof backendRoleInputSchema>
export type BackendApiKeyInput = z.infer<typeof backendApiKeyInputSchema>
export type BackendApiKeyOutput = z.infer<typeof backendApiKeyOutputSchema>
export type BackendApiKeyQuery = z.infer<typeof backendApiKeyQuerySchema>
export type BackendApiKeyTokenOutput = z.infer<typeof backendApiKeyTokenOutputSchema>
export type BackendRoleOutput = z.infer<typeof backendRoleOutputSchema>
export type BackendRoleQuery = z.infer<typeof backendRoleQuerySchema>
export type BackendServiceAccountInput = z.infer<typeof backendServiceAccountInputSchema>
export type BackendServiceAccountOutput = z.infer<typeof backendServiceAccountOutputSchema>
export type BackendServiceAccountQuery = z.infer<typeof backendServiceAccountQuerySchema>
export type BackendApiKeyServiceAccountOption = z.infer<
  typeof backendApiKeyServiceAccountOptionSchema
>
export type ServiceAccountBackendRoleBindingOutput = z.infer<
  typeof serviceAccountBackendRoleBindingOutputSchema
>
export type BackendServiceAccountProjectBindingOutput = z.infer<
  typeof backendServiceAccountProjectBindingOutputSchema
>
export type BackendProjectServiceAccountOption = z.infer<
  typeof backendProjectServiceAccountOptionSchema
>
export type BackendRoleRestrictionOption = z.infer<typeof backendRoleRestrictionOptionSchema>
export type BackendRoleRestrictionOptions = z.infer<typeof backendRoleRestrictionOptionsSchema>
