import { objectMetaSchema } from "@highstate/contract"
import { z } from "zod"

export const backendUnlockMethodMetaSchema = objectMetaSchema
  .pick({ title: true, description: true })
  .required({ title: true })

export const backendUnlockMethodInputSchema = z.object({
  meta: backendUnlockMethodMetaSchema,
  recipient: z.string(),
})

export type BackendUnlockMethodMeta = z.infer<typeof backendUnlockMethodMetaSchema>
export type BackendUnlockMethodInput = z.infer<typeof backendUnlockMethodInputSchema>
