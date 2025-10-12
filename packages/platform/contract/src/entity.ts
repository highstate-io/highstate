import type { PartialKeys } from "./utils"
import { z } from "zod"
import { camelCaseToHumanReadable } from "./i18n"
import {
  objectMetaSchema,
  parseVersionedName,
  type VersionedName,
  versionedNameSchema,
} from "./meta"

/**
 * The entity is some abstract object which can be passed from one component to another through their inputs and outputs.
 * Every entity must have a type.
 * Every component inputs and outputs will reference such types and only entities of the same type can be passed.
 */
export const entityModelSchema = z.object({
  /**
   * The static type of the entity.
   */
  type: versionedNameSchema,

  /**
   * The JSON schema of the entity value.
   */
  schema: z.custom<z.core.JSONSchema.BaseSchema>(),

  /**
   * The extra metadata of the entity.
   */
  meta: objectMetaSchema.required({ title: true }).pick({
    title: true,
    description: true,
    color: true,
    icon: true,
    iconColor: true,
  }),

  /**
   * The CRC32 of the entity definition.
   */
  definitionHash: z.number(),
})

export type EntityModel = z.infer<typeof entityModelSchema>

export type Entity<
  TType extends VersionedName = VersionedName,
  TSchema extends z.ZodType = z.ZodType,
> = {
  /**
   * The static type of the entity.
   */
  type: TType

  /**
   * The zod schema of the entity value.
   */
  schema: TSchema

  /**
   * The model of the entity.
   */
  model: EntityModel
}

type EntityOptions<TType extends VersionedName, TSchema extends z.ZodType> = {
  /**
   * The static type of the entity.
   */
  type: TType

  /**
   * The JSON schema of the entity value.
   */
  schema: TSchema

  /**
   * The extra metadata of the entity.
   */
  meta?: PartialKeys<z.infer<typeof objectMetaSchema>, "title">
}

export function defineEntity<TType extends VersionedName, TSchema extends z.ZodType>(
  options: EntityOptions<TType, TSchema>,
): Entity<TType, TSchema> {
  try {
    entityModelSchema.shape.type.parse(options.type)
  } catch (error) {
    throw new Error(`Invalid entity type "${options.type}"`, { cause: error })
  }

  if (!options.schema) {
    throw new Error("Entity schema is required")
  }

  try {
    return {
      type: options.type,
      schema: options.schema,
      model: {
        type: options.type,
        schema: z.toJSONSchema(options.schema, { target: "draft-7" }),
        meta: {
          ...options.meta,
          title:
            options.meta?.title || camelCaseToHumanReadable(parseVersionedName(options.type)[0]),
        },
        // will be calculated by the library loader
        definitionHash: null!,
      },
    }
  } catch (error) {
    throw new Error(`Failed to define entity "${options.type}"`, { cause: error })
  }
}

export function isEntity(value: unknown): value is Entity {
  return typeof value === "object" && value !== null && "model" in value
}
