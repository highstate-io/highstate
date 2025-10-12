import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

export const triggerOutputSchema = z.object({
  id: z.cuid2(),
  meta: commonObjectMetaSchema,
  name: z.string(),
  stateId: z.cuid2(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type TriggerOutput = z.infer<typeof triggerOutputSchema>

export const triggerQuerySchema = collectionQuerySchema.extend({
  stateId: z.string().optional(),
})

export type TriggerQuery = z.infer<typeof triggerQuerySchema>
