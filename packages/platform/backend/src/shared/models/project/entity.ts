import { commonObjectMetaSchema } from "@highstate/contract"
import { z } from "zod"
import { collectionQuerySchema } from "../base"

const rawEntityMetaSchema = z
  .object({
    identity: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    iconColor: z.string().optional(),
  })
  .passthrough()

export const entityOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  identity: z.string(),
  meta: commonObjectMetaSchema,

  /**
   * The ID of the last known entity snapshot.
   */
  snapshotId: z.string().optional(),

  /**
   * The timestamp of the last known entity snapshot.
   */
  createdAt: z.date().optional(),
})

export type EntityOutput = z.infer<typeof entityOutputSchema>

export const entityQuerySchema = collectionQuerySchema.extend({
  type: z.string().optional(),
})

export type EntityQuery = z.infer<typeof entityQuerySchema>

export const entitySnapshotOutputSchema = z.object({
  id: z.string(),
  meta: commonObjectMetaSchema,
  content: z.unknown(),
  operationId: z.string(),
  stateId: z.string(),
  referencedOutputs: z.string().array(),
  exportedOutputs: z.string().array(),
  createdAt: z.date(),
})

export type EntitySnapshotOutput = z.infer<typeof entitySnapshotOutputSchema>

export const entitySnapshotListItemOutputSchema = z.object({
  id: z.string(),
  meta: commonObjectMetaSchema,
  operationId: z.string(),
  stateId: z.string(),
  createdAt: z.date(),
})

export type EntitySnapshotListItemOutput = z.infer<typeof entitySnapshotListItemOutputSchema>

export const entitySnapshotDetailsOutputSchema = z.object({
  entity: z.object({
    id: z.string(),
    type: z.string(),
    identity: z.string(),
  }),
  snapshot: entitySnapshotOutputSchema,
})

export type EntitySnapshotDetailsOutput = z.infer<typeof entitySnapshotDetailsOutputSchema>

export const entityDetailsOutputSchema = z.object({
  ...entityOutputSchema.shape,

  /**
   * The last known entity snapshot.
   */
  lastSnapshot: entitySnapshotOutputSchema.nullable(),
})

export type EntityDetailsOutput = z.infer<typeof entityDetailsOutputSchema>

export const entityReferenceOutputSchema = z.object({
  id: z.string(),
  meta: commonObjectMetaSchema,
  group: z.string(),

  fromSnapshotId: z.string(),
  fromEntityId: z.string(),
  fromEntityType: z.string(),
  fromEntityIdentity: z.string(),
  fromEntityMeta: commonObjectMetaSchema,

  toSnapshotId: z.string(),
  toEntityId: z.string(),
  toEntityType: z.string(),
  toEntityIdentity: z.string(),
  toEntityMeta: commonObjectMetaSchema,
})

export type EntityReferenceOutput = z.infer<typeof entityReferenceOutputSchema>

export function toCommonEntityMeta(
  meta: unknown | null | undefined,
): z.infer<typeof commonObjectMetaSchema> {
  const parsedRawMeta = rawEntityMetaSchema.safeParse(meta)
  if (parsedRawMeta.success) {
    return {
      title: parsedRawMeta.data.title ?? parsedRawMeta.data.identity ?? "Unknown",
      description: parsedRawMeta.data.description,
      icon: parsedRawMeta.data.icon,
      iconColor: parsedRawMeta.data.iconColor,
    }
  }

  return {
    title: "Unknown",
  }
}
