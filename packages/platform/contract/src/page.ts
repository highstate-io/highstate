import { z } from "zod"
import { objectMetaSchema } from "./meta"
import { fileSchema } from "./pulumi"

/**
 * Page block schema for database storage and unit API.
 */
export const pageBlockSchema = z.union([
  z.object({
    type: z.literal("markdown"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("qr"),
    content: z.string(),
    showContent: z.coerce.boolean(),
    language: z.string().optional(),
  }),
  z.object({
    type: z.literal("file"),
    file: fileSchema,
  }),
])

export type PageBlock = z.infer<typeof pageBlockSchema>

/**
 * Page schema for unit API.
 * This is what units provide - excludes id, instanceId and some fields from meta since those are set by the system.
 */
export const unitPageSchema = z.object({
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
  content: pageBlockSchema.array(),
})

export type UnitPage = z.infer<typeof unitPageSchema>
