import { z } from "@highstate/contract"

export const userMetaSchema = z.object({
  title: z.string().min(1),
  username: z.string().min(1).optional(),
  email: z.email().optional(),
  avatarUrl: z.url().optional(),
})

export type UserMeta = z.infer<typeof userMetaSchema>

export const userTypeSchema = z.enum(["local", "oidc"])

export type UserType = z.infer<typeof userTypeSchema>

export const userOutputSchema = z.object({
  id: z.cuid2(),
  type: userTypeSchema,
  meta: userMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type UserOutput = z.infer<typeof userOutputSchema>

export const userGroupMetaSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  avatarUrl: z.url().optional(),
})

export type UserGroupMeta = z.infer<typeof userGroupMetaSchema>

export const userGroupOutputSchema = z.object({
  id: z.cuid2(),
  meta: userGroupMetaSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type UserGroupOutput = z.infer<typeof userGroupOutputSchema>
