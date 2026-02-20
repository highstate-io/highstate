import type { IsEmptyObject, Simplify } from "type-fest"
import type { PartialKeys } from "./utils"
import { z } from "zod"
import { camelCaseToHumanReadable } from "./i18n"
import {
  objectMetaSchema,
  parseVersionedName,
  type VersionedName,
  versionedNameSchema,
} from "./meta"
import { cuidv2d } from "./uuidv2d"

export const entityInclusionSchema = z.object({
  /**
   * The static type of the included entity.
   */
  type: versionedNameSchema,

  /**
   * Whether the included entity is required.
   * If false, the entity may be omitted.
   */
  required: z.boolean(),

  /**
   * Whether the included entity is multiple.
   */
  multiple: z.boolean(),

  /**
   * The name of the field where the included entity is embedded.
   */
  field: z.string(),
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
   * The list of all extended entity types (direct and indirect).
   */
  extensions: z.string().array().optional(),

  /**
   * The list of directly extended entity types.
   */
  directExtensions: z.string().array().optional(),

  /**
   * The list of all included entities (directly or inherited from extensions).
   */
  inclusions: entityInclusionSchema.array().optional(),

  /**
   * The list of directly included entities.
   */
  directInclusions: entityInclusionSchema.array().optional(),

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

export type EntityInclusion = z.infer<typeof entityInclusionSchema>
export type EntityModel = z.infer<typeof entityModelSchema>
export type EntityTypes = Record<VersionedName, true>

export declare const implementedTypes: unique symbol

export type Entity<
  TType extends VersionedName = VersionedName,
  TImplementedTypes extends EntityTypes = EntityTypes,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  /**
   * The static type of the entity.
   */
  type: TType

  /**
   * The all types implemented by this entity including its own type.
   *
   * Does not exist at runtime.
   */
  [implementedTypes]: TImplementedTypes

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
   * Inclusion is more powerful mechanism that allows to embed other entities into this entity
   * and then substitute them instead of this entity when connected to component inputs of included types.
   */
  includes?: TIncludes
}

export type EntityIncludeRef = Entity | { entity: Entity; multiple?: boolean; required?: boolean }

function isEntityIncludeRef(
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

type AddSchemaExtensions<
  TSchema extends z.ZodTypeAny,
  TExtends extends Record<string, Entity>,
> = TExtends extends Record<string, never>
  ? TSchema
  : IsEmptyObject<TExtends> extends true
    ? TSchema
    : {
        [K in keyof TExtends]: AddSchemaExtensions<
          z.ZodIntersection<TSchema, TExtends[K]["schema"]>,
          Omit<TExtends, K>
        >
      }[keyof TExtends]

type AddTypeExtensions<
  TImplementedTypes extends EntityTypes,
  TExtends extends Record<string, Entity>,
> = TExtends extends Record<string, never>
  ? TImplementedTypes
  : IsEmptyObject<TExtends> extends true
    ? TImplementedTypes
    : {
        [K in keyof TExtends]: AddTypeExtensions<
          TImplementedTypes & TExtends[K][typeof implementedTypes],
          Omit<TExtends, K>
        >
      }[keyof TExtends]

type AddSchemaInclusions<
  TSchema extends z.ZodTypeAny,
  TImplements extends Record<string, EntityIncludeRef>,
> = TImplements extends Record<string, never>
  ? TSchema
  : z.ZodIntersection<TSchema, z.ZodObject<InclusionShape<TImplements>>>

type AddTypeInclusions<
  TImplementedTypes extends EntityTypes,
  TImplements extends Record<string, EntityIncludeRef>,
> = TImplements extends Record<string, never>
  ? TImplementedTypes
  : {
      [K in keyof TImplements]: TImplements[K] extends {
        entity: infer E
      }
        ? E extends Entity
          ? AddTypeInclusions<TImplementedTypes & E[typeof implementedTypes], Omit<TImplements, K>>
          : TImplementedTypes
        : TImplements[K] extends Entity
          ? AddTypeInclusions<
              TImplementedTypes & TImplements[K][typeof implementedTypes],
              Omit<TImplements, K>
            >
          : TImplementedTypes
    }[keyof TImplements]

type MakeEntitySchema<TSchema extends z.ZodType, TType extends VersionedName> = z.ZodIntersection<
  TSchema,
  z.ZodObject<{
    $meta: z.ZodOptional<
      z.ZodObject<
        {
          type: z.ZodLiteral<TType>
        } & Omit<typeof entityMetaSchema.shape, "type">
      >
    >
  }>
>

export function defineEntity<
  TType extends VersionedName,
  TSchema extends z.ZodType,
  TExtends extends Record<string, Entity> = Record<string, never>,
  TImplements extends Record<string, EntityIncludeRef> = Record<string, never>,
>(
  options: EntityOptions<TType, TSchema, TExtends, TImplements>,
): Entity<
  TType,
  Simplify<AddTypeInclusions<AddTypeExtensions<{ [K in TType]: true }, TExtends>, TImplements>>,
  MakeEntitySchema<AddSchemaExtensions<AddSchemaInclusions<TSchema, TImplements>, TExtends>, TType>
> {
  try {
    entityModelSchema.shape.type.parse(options.type)
  } catch (error) {
    throw new Error(`Invalid entity type "${options.type}"`, { cause: error })
  }

  if (!options.schema) {
    throw new Error("Entity schema is required")
  }

  const includedEntities: { entity: Entity; inclusion: EntityInclusion }[] = Object.entries(
    options.includes ?? {},
  ).map(([field, entityRef]) => {
    if (isEntityIncludeRef(entityRef)) {
      return {
        entity: entityRef.entity,
        inclusion: {
          type: entityRef.entity.type,
          required: entityRef.required ?? true,
          multiple: entityRef.multiple ?? false,
          field,
        },
      }
    }

    return {
      entity: entityRef,
      inclusion: {
        type: entityRef.type,
        required: true,
        multiple: false,
        field,
      },
    }
  })

  const inclusionShape = includedEntities.reduce(
    (shape, { entity, inclusion }) => {
      if (inclusion.multiple) {
        shape[inclusion.field] = inclusion.required
          ? entity.schema.array()
          : entity.schema.array().optional()
      } else {
        shape[inclusion.field] = inclusion.required ? entity.schema : entity.schema.optional()
      }

      return shape
    },
    {} as Record<string, z.ZodTypeAny>,
  )

  let finalSchema = Object.values(options.extends ?? {}).reduce(
    (schema, entity) => z.intersection(schema, entity.schema),
    options.schema as z.ZodType,
  )

  if (includedEntities.length > 0) {
    finalSchema = z.intersection(finalSchema, z.object(inclusionShape))
  }

  const directInclusions = includedEntities.map(({ inclusion }) => inclusion)
  const directExtensions = Object.values(options.extends ?? {}).map(entity => entity.type)

  const inclusions = Object.values(options.extends ?? {}).reduce(
    (incs, entity) => {
      if (entity.model.inclusions) {
        incs.push(...entity.model.inclusions)
      }

      return incs
    },
    [...directInclusions],
  )

  const extensions = Object.values(options.extends ?? {}).reduce((exts, entity) => {
    exts.push(...(entity.model.extensions ?? []), entity.type)

    return exts
  }, [] as string[])

  try {
    let _schema: z.core.JSONSchema.BaseSchema

    return {
      type: options.type,
      schema: finalSchema,
      model: {
        type: options.type,
        extensions: extensions.length > 0 ? extensions : undefined,
        directExtensions: directExtensions.length > 0 ? directExtensions : undefined,
        inclusions: inclusions.length > 0 ? inclusions : undefined,
        directInclusions: directInclusions.length > 0 ? directInclusions : undefined,
        get schema() {
          if (!_schema) {
            // TODO: forbid unrepresentable types (and find way to filter out "undefined" literals)
            _schema = z.toJSONSchema(finalSchema, { target: "draft-7", unrepresentable: "any" })
          }

          return _schema
        },
        meta: {
          ...options.meta,
          title:
            options.meta?.title || camelCaseToHumanReadable(parseVersionedName(options.type)[0]),
        },
        // will be calculated by the library loader
        definitionHash: null!,
      },
      // biome-ignore lint/suspicious/noExplicitAny: we already typed return type
    } as any
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
 * - The entity extends the target type (either directly or indirectly).
 * - The entity includes the target type (either directly or indirectly).
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

  return entity.inclusions?.some(implementation => implementation.type === target) ?? false
}

export const entityMetaSchema = z.object({
  /**
   * The type of the entity.
   */
  type: versionedNameSchema,

  /**
   * The globally unique value of the entity used to produce the entity ID for non-anonymous entities.
   */
  identity: z.string().optional(),

  /**
   * The IDs of the entities to reference by this entity.
   * Must already exist in the system (or be at least defined by this unit).
   */
  references: z.string().array().optional(),

  ...objectMetaSchema.pick({
    title: true,
    description: true,
    icon: true,
    iconColor: true,
  }).shape,
})

export type EntityMeta = z.infer<typeof entityMetaSchema>

export const entityWithMetaSchema = z.object({
  $meta: entityMetaSchema.optional(),
})

export type EntityWithMeta = z.infer<typeof entityWithMetaSchema>

const entityIdCache = new WeakMap<EntityWithMeta, string>()
const entityIdNamespace = "3cd37048-7c50-43a9-a2b9-ff7ff2b5ee79"

/**
 * Gets the unique ID of an entity based on its type and identity.
 *
 * The ID is generated using a hash of the entity's type and identity, and is cached for future retrievals.
 *
 * @param entity The entity to get the ID for.
 * @returns The unique ID of the entity, or undefined if the entity is anonymous or does not have an identity.
 */
export function getEntityId(entity: EntityWithMeta): string | undefined {
  const existingId = entityIdCache.get(entity)

  if (existingId) {
    return existingId
  }

  if (!entity.$meta) {
    return undefined
  }

  const { type, identity } = entity.$meta

  if (!identity) {
    return undefined
  }

  const id = cuidv2d(entityIdNamespace, `${type}:${identity}`)
  entityIdCache.set(entity, id)

  return id
}

/**
 * Gets the unique ID of an entity, throwing an error if the entity does not have an ID.
 *
 * @param entity The entity to get the ID for.
 * @returns The unique ID of the entity.
 * @throws Will throw an error if the entity does not have an ID.
 */
export function requireEntityId(entity: EntityWithMeta): string {
  const id = getEntityId(entity)

  if (!id) {
    throw new Error("Entity does not have an ID")
  }

  return id
}
