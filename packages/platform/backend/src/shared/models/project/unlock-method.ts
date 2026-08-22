import { objectMetaSchema, z } from "@highstate/contract"

export const unlockMethodType = z.enum(["password", "passkey"])

export const unlockMethodMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
  })
  .required({ title: true })

export const unlockMethodInputSchema = z.discriminatedUnion("type", [
  z.object({
    meta: unlockMethodMetaSchema,
    type: z.literal("password"),
    encryptedIdentity: z.string(),
    recipient: z.string(),
  }),
  z.object({
    meta: unlockMethodMetaSchema,
    type: z.literal("passkey"),
    encryptedIdentity: z.string(),
    passkeyIdentity: z.string(),
    recipient: z.string(),
  }),
])

export const unlockMethodOutputSchema = z.object({
  id: z.cuid2(),
  type: unlockMethodType,
  meta: unlockMethodMetaSchema,
  recipient: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type UnlockMethodOutput = z.infer<typeof unlockMethodOutputSchema>

export type UnlockMethodMeta = z.infer<typeof unlockMethodMetaSchema>
export type UnlockMethodInput = z.infer<typeof unlockMethodInputSchema>
export type UnlockMethodType = z.infer<typeof unlockMethodType>
