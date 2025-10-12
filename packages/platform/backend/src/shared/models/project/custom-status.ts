import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"

export const instanceCustomStatusInputSchema = z.object({
  name: z.string(),
  meta: commonObjectMetaSchema,
  value: z.string(),
  message: z.string().optional(),
  order: z.number().min(0).max(100).optional(),
})

export type InstanceCustomStatusInput = z.infer<typeof instanceCustomStatusInputSchema>
