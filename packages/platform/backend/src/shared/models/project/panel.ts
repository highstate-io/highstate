import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

export const panelInputSchema = z.object({
  name: z.string().min(1),
  meta: commonObjectMetaSchema,
})

export type PanelInput = z.infer<typeof panelInputSchema>

export const panelOutputSchema = z.object({
  id: z.cuid2(),
  name: z.string(),
  meta: commonObjectMetaSchema,
  stateId: z.cuid2(),
  serviceAccountId: z.cuid2(),
  serviceAccountMeta: commonObjectMetaSchema,
  workerVersionId: z.cuid2(),
  workerVersionMeta: commonObjectMetaSchema,
  workerId: z.cuid2(),
  online: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type PanelOutput = z.infer<typeof panelOutputSchema>

export const panelAvailabilityEventSchema = z.object({
  online: z.boolean(),
})

export type PanelAvailabilityEvent = z.infer<typeof panelAvailabilityEventSchema>

export const panelQuerySchema = collectionQuerySchema.extend({
  stateId: z.cuid2().optional(),
  serviceAccountId: z.cuid2().optional(),
  workerVersionId: z.cuid2().optional(),
})

export type PanelQuery = z.infer<typeof panelQuerySchema>
