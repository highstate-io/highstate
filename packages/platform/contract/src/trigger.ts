import { z } from "zod"
import { objectMetaSchema } from "./meta"

export const triggerSpecSchema = z.union([
  z.object({
    type: z.literal("before-destroy"),
  }),
])

export type TriggerSpec = z.infer<typeof triggerSpecSchema>

/**
 * Trigger schema for unit API.
 * This is what units provide - excludes id since it's set by the system.
 */
export const unitTriggerSchema = z.object({
  name: z.string(),
  meta: objectMetaSchema
    .pick({
      title: true,
      globalTitle: true,
      description: true,
      icon: true,
      iconColor: true,
    })
    .required({ title: true }),

  /**
   * The specification of the trigger.
   *
   * Defines the type of trigger and its behavior.
   */
  spec: triggerSpecSchema,
})

export type UnitTrigger = z.infer<typeof unitTriggerSchema>

export const triggerInvocationSchema = z.object({
  /**
   * The name of the trigger being invoked.
   */
  name: z.string(),
})

export type TriggerInvocation = z.infer<typeof triggerInvocationSchema>
