import { commonObjectMetaSchema, componentInputSchema } from "@highstate/contract"
import { z } from "zod"

export const exportedEntitySchema = z.object({
  /**
   * The type of the exported entity.
   */
  type: z.string(),

  /**
   * The identity of the exported entity.
   */
  identity: z.string(),

  /**
   * The names of the outputs where this entity was referenced (including nested entities).
   */
  referencedInOutputs: z.string().array(),

  /**
   * The names of the outputs that exported this entity directly.
   */
  exportedInOutputs: z.string().array(),

  /**
   * The metadata of the exported entity.
   */
  meta: commonObjectMetaSchema.partial(),

  /**
   * The content of the exported entity.
   */
  content: z.unknown(),
})

export const exportedEntityReferenceSchema = z.object({
  /**
   * The CUIDv2 of the source entity.
   */
  fromId: z.string(),

  /**
   * The CUIDv2 of the target entity.
   */
  toId: z.string(),

  /**
   * The kind of the reference.
   */
  kind: z.enum(["explicit", "inclusion"]),

  /**
   * The group of the reference.
   */
  group: z.string(),
})

export const projectImportPortDataSchema = z.object({
  /**
   * The meta for the import/export port.
   */
  meta: commonObjectMetaSchema,

  /**
   * The model of the outputs defined by this export port.
   */
  outputs: z.record(z.string(), componentInputSchema),

  /**
   * The entities that are exported by this export port.
   */
  entities: exportedEntitySchema.array(),

  /**
   * The references between the exported entities in this export port.
   */
  references: exportedEntityReferenceSchema.array(),
})

export type ProjectImportPortData = z.infer<typeof projectImportPortDataSchema>
export type ExportedEntity = z.infer<typeof exportedEntitySchema>
export type ExportedEntityReference = z.infer<typeof exportedEntityReferenceSchema>
