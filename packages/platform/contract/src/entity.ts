import type { PartialKeys } from "./utils"
import { z } from "zod"
import { camelCaseToHumanReadable } from "./i18n"
import {
  objectMetaSchema,
  parseVersionedName,
  type VersionedName,
  versionedNameSchema,
} from "./meta"
import type { IsEmptyObject } from "type-fest"

export const implementedEntityModelSchema = z.object({
  /**
   * The static type of the implemented entity.
   */
  type: versionedNameSchema,

  /**
   * Whether the implemented entity is required.
   * If false, the entity may be omitted.
   */
  required: z.boolean(),

  /**
   * Whether the implemented entity is multiple.
   */
  multiple: z.boolean(),
})

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
   * The list of extended entity types.
   */
  extensions: z.string().array().optional(),

  /**
   * The list of implemented entities.
   */
  implementations: implementedEntityModelSchema.array().optional(),

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
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
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

type EntityOptions<
  TType extends VersionedName,
  TSchema extends z.ZodType,
  TExtends extends Record<string, Entity>,
  TIncludes extends Record<string, EntityIncludeRef>,
> = {
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

  /**
   * The list of entities to extend.
   *
   * The intersection of them will be used as the base schema and then intersected again with the provided schema.
   *
   * Note: Intersection does not mean inheritance or blind property merging.
   * If two base types have field with the same name but different types,
   * the resulting type of the field will be the intersection of the two types (and most likely `never`).
   */
  extends?: TExtends

  /**
   * The list of entities to include.
   *
   * Implementation is more powerful mechanism that allows to embed other entities into this entity
   * and then substitute them instead of this entity when connected to component inputs of implemented types.
   */
  includes?: TIncludes
}

export type EntityIncludeRef = Entity | { entity: Entity; multiple?: boolean; required?: boolean }

function isImplementEntityRef(
  value: EntityIncludeRef,
): value is { entity: Entity; multiple?: boolean; required?: boolean } {
  return typeof value === "object" && value !== null && "entity" in value
}

type InclusionShape<TImplements extends Record<string, EntityIncludeRef>> = {
  [K in keyof TImplements]: TImplements[K] extends {
    entity: infer E
    multiple?: infer M
    required?: infer R
  }
    ? E extends Entity
      ? M extends true
        ? R extends false
          ? z.ZodOptional<z.ZodArray<E["schema"]>>
          : z.ZodArray<E["schema"]>
        : R extends false
          ? z.ZodOptional<E["schema"]>
          : E["schema"]
      : never
    : TImplements[K] extends Entity
      ? TImplements[K]["schema"]
      : never
}

type AddExtensions<
  TSchema extends z.ZodTypeAny,
  TExtends extends Record<string, Entity>,
> = TExtends extends Record<string, never>
  ? TSchema
  : IsEmptyObject<TExtends> extends true
    ? TSchema
    : {
        [K in keyof TExtends]: AddExtensions<
          z.ZodIntersection<TSchema, TExtends[K]["schema"]>,
          Omit<TExtends, K>
        >
      }[keyof TExtends]

type AddInclusions<
  TSchema extends z.ZodTypeAny,
  TImplements extends Record<string, EntityIncludeRef>,
> = TImplements extends Record<string, never>
  ? TSchema
  : z.ZodIntersection<TSchema, z.ZodObject<InclusionShape<TImplements>>>

export function defineEntity<
  TType extends VersionedName,
  TSchema extends z.ZodType,
  TExtends extends Record<string, Entity> = Record<string, never>,
  TImplements extends Record<string, EntityIncludeRef> = Record<string, never>,
>(
  options: EntityOptions<TType, TSchema, TExtends, TImplements>,
): Entity<TType, AddExtensions<AddInclusions<TSchema, TImplements>, TExtends>> {
  try {
    entityModelSchema.shape.type.parse(options.type)
  } catch (error) {
    throw new Error(`Invalid entity type "${options.type}"`, { cause: error })
  }

  if (!options.schema) {
    throw new Error("Entity schema is required")
  }

  const implementedEntityRefs = Object.values(options.includes ?? {})

  const implementedEntities = implementedEntityRefs.map(entityRef => {
    return isImplementEntityRef(entityRef) ? entityRef.entity : entityRef
  })

  const implementedEntitiesByType = new Map(
    implementedEntities.map(entity => [entity.type, entity]),
  )

  const implementedTypes = implementedEntities.map(entity => {
    try {
      entityModelSchema.shape.type.parse(entity.type)
    } catch (error) {
      throw new Error(`Invalid implemented entity type "${entity.type}" for "${options.type}"`, {
        cause: error,
      })
    }

    return entity.type
  })

  const duplicateType = implementedTypes.find((type, index) => {
    return implementedTypes.indexOf(type) !== index
  })

  if (duplicateType) {
    throw new Error(`Duplicate implemented entity type "${duplicateType}" for "${options.type}"`)
  }

  const implementedModels = implementedEntityRefs.map(entityRef => {
    if (isImplementEntityRef(entityRef)) {
      return {
        type: entityRef.entity.type,
        required: entityRef.required ?? true,
        multiple: entityRef.multiple ?? false,
      }
    }

    return {
      type: entityRef.type,
      required: true,
      multiple: false,
    }
  })

  const implementationShape = implementedModels.reduce<Record<string, z.ZodTypeAny>>(
    (shape, implementedModel) => {
      const baseSchema = implementedEntitiesByType.get(implementedModel.type)?.schema

      if (!baseSchema) {
        return shape
      }

      const implementationSchema = implementedModel.multiple ? z.array(baseSchema) : baseSchema

      shape[implementedModel.type] = implementedModel.required
        ? implementationSchema
        : implementationSchema.optional()

      return shape
    },
    {},
  )

  const embeddedSchema = (() => {
    if (implementedModels.length === 0) {
      return options.schema
    }

    if (options.schema instanceof z.ZodIntersection) {
      return z.intersection(options.schema, z.object(implementationShape))
    }

    if (options.schema instanceof z.ZodObject) {
      return z.object({ ...options.schema.shape, ...implementationShape })
    }

    return options.schema
  })()

  try {
    return {
      type: options.type,
      schema: embeddedSchema,
      model: {
        type: options.type,
        implementations: implementedModels.length > 0 ? implementedModels : undefined,
        schema: z.toJSONSchema(embeddedSchema, { target: "draft-7" }),
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

/**
 * Checks whether the given entity can be assigned to the target type.
 *
 * An entity is considered assignable to a target type if:
 * - The entity's type is exactly the same as the target type.
 * - The entity extends the target type.
 * - The entity implements the target type.
 *
 * @param entity The entity to check.
 * @param target The target versioned name to check against.
 * @returns True if the entity is assignable to the target type, false otherwise.
 */
export function isAssignableTo(entity: EntityModel, target: VersionedName): boolean {
  if (entity.type === target) {
    return true
  }

  if (entity.extensions?.includes(target)) {
    return true
  }

  return entity.implementations?.some(implementation => implementation.type === target) ?? false
}
