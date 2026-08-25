import { commonObjectMetaSchema, genericNameSchema, timestampsSchema, z } from "@highstate/contract"
import { collectionQuerySchema } from "../base"
import { projectRoleRulesSchema } from "./role"

export const projectRoleInputSchema = z.object({
  meta: commonObjectMetaSchema.extend({ title: z.string().trim().min(1) }),
  rules: projectRoleRulesSchema,
})

export const projectRoleOutputSchema = projectRoleInputSchema.extend({
  id: z.cuid2(),
  systemName: genericNameSchema.nullable(),
  ...timestampsSchema.shape,
})

export const projectRoleQuerySchema = collectionQuerySchema

export const projectRoleBindingOutputSchema = z.object({
  roleId: z.cuid2(),
  serviceAccountId: z.cuid2(),
  createdAt: z.date(),
})

export const projectRoleRestrictionOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
})

export const projectRoleRestrictionOptionsSchema = z.object({
  resources: z.record(z.string(), z.array(projectRoleRestrictionOptionSchema)),
  instances: z.array(projectRoleRestrictionOptionSchema),
  serviceAccounts: z.array(projectRoleRestrictionOptionSchema),
  workers: z.array(projectRoleRestrictionOptionSchema),
})

export const apiKeyServiceAccountOptionSchema = z.object({
  id: z.cuid2(),
  meta: commonObjectMetaSchema,
  systemName: genericNameSchema.nullable(),
  rules: z.array(projectRoleRulesSchema.element),
})

export type ProjectRoleInput = z.infer<typeof projectRoleInputSchema>
export type ProjectRoleOutput = z.infer<typeof projectRoleOutputSchema>
export type ProjectRoleQuery = z.infer<typeof projectRoleQuerySchema>
export type ProjectRoleBindingOutput = z.infer<typeof projectRoleBindingOutputSchema>
export type ProjectRoleRestrictionOptions = z.infer<typeof projectRoleRestrictionOptionsSchema>
export type ApiKeyServiceAccountOption = z.infer<typeof apiKeyServiceAccountOptionSchema>
