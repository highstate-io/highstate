import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"

export const instanceLockOutputSchema = z.object({
  stateId: z.cuid2(),
  meta: commonObjectMetaSchema,
  acquiredAt: z.date(),
})

export type InstanceLockOutput = z.infer<typeof instanceLockOutputSchema>

export const instanceLockEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("locked"),
    locks: instanceLockOutputSchema.array(),
  }),
  z.object({
    type: z.literal("unlocked"),
    stateIds: z.array(z.string()),
  }),
])

export type InstanceLockEvent = z.infer<typeof instanceLockEventSchema>
