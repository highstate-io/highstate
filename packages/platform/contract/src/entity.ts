import type { IsEmptyObject, Simplify } from "type-fest"
import type { PartialKeys } from "./utils"
import { z } from "zod"
import { cuidv2d } from "./cuidv2d"
import { camelCaseToHumanReadable } from "./i18n"
import { fixJsonSchema } from "./json-schema"
import {
  objectMetaSchema,
  parseVersionedName,
  type VersionedName,
  versionedNameSchema,
} from "./meta"

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
export declare const entityOutput: unique symbol
export declare const entityInput: unique symbol
export declare const entityIncludes: unique symbol

export type Entity<
  TType extends VersionedName = VersionedName,
  TImplementedTypes extends EntityTypes = EntityTypes,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = z.output<TSchema>,
  TInput = z.input<TSchema>,
  TIncludes extends Record<string, unknown> = Record<string, unknown>,
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
   * The inferred value type of the entity.
   *
   * Does not exist at runtime.
   */
  [entityOutput]: TOutput

  /**
   * The inferred input type of the entity.
   *
   * Does not exist at runtime.
   */
  [entityInput]: TInput

  /**
   * The record of entity inclusions defined in `defineEntity({ includes: ... })`.
   *
   * Does not exist at runtime.
   */
  [entityIncludes]: TIncludes

  /**
   * The model of the entity.
   */
  model: EntityModel
}

export type EntityValue<TEntity> = TEntity extends { [entityOutput]: infer TValue } ? TValue : never

/**
 * The input type accepted by the entity schema.
 */
export type EntityValueInput<TEntity> = TEntity extends { [entityInput]: infer TValue }
  ? TValue
  : never

type DistributiveSimplify<T> = T extends unknown ? Simplify<T> : never

type ResolveIncludeEntity<TIncludeRef> = TIncludeRef extends { entity: infer E }
  ? E extends () => infer ER
    ? ER
    : E
  : TIncludeRef

type IsIncludeMultiple<TIncludeRef> = TIncludeRef extends { multiple?: infer M }
  ? M extends true
    ? true
    : false
  : false

type IsIncludeRequired<TIncludeRef> = TIncludeRef extends { required?: infer R }
  ? R extends false
    ? false
    : true
  : true

type IsOptionalOutputInclude<TIncludeRef> = IsIncludeMultiple<TIncludeRef> extends true
  ? false
  : IsIncludeRequired<TIncludeRef> extends false
    ? true
    : false

type IsOptionalInputInclude<TIncludeRef> = IsIncludeRequired<TIncludeRef> extends false
  ? true
  : false

type IncludeOutputValue<TIncludeRef> = IsIncludeMultiple<TIncludeRef> extends true
  ? EntityValue<ResolveIncludeEntity<TIncludeRef>>[]
  : EntityValue<ResolveIncludeEntity<TIncludeRef>>

type IncludeInputValue<TIncludeRef> = IsIncludeMultiple<TIncludeRef> extends true
  ? EntityValueInput<ResolveIncludeEntity<TIncludeRef>>[]
  : EntityValueInput<ResolveIncludeEntity<TIncludeRef>>

type InclusionValueShape<TIncludes extends Record<string, EntityIncludeRef>> =
  TIncludes extends Record<string, never>
    ? Record<never, never>
    : {
        -readonly [K in keyof TIncludes as IsOptionalOutputInclude<TIncludes[K]> extends true
          ? never
          : K]-?: IncludeOutputValue<TIncludes[K]>
      } & {
        -readonly [K in keyof TIncludes as IsOptionalOutputInclude<TIncludes[K]> extends true
          ? K
          : never]?: IncludeOutputValue<TIncludes[K]>
      }

type InclusionInputShape<TIncludes extends Record<string, EntityIncludeRef>> =
  TIncludes extends Record<string, never>
    ? Record<never, never>
    : {
        -readonly [K in keyof TIncludes as IsOptionalInputInclude<TIncludes[K]> extends true
          ? never
          : K]-?: IncludeInputValue<TIncludes[K]>
      } & {
        -readonly [K in keyof TIncludes as IsOptionalInputInclude<TIncludes[K]> extends true
          ? K
          : never]?: IncludeInputValue<TIncludes[K]>
      }

type DefineEntityValue<
  TSchema extends z.ZodType,
  TExtends extends Record<string, Entity>,
  TIncludes extends Record<string, EntityIncludeRef>,
> = DistributiveSimplify<
  z.output<MakeEntitySchema<AddSchemaExtensions<TSchema, TExtends>>> &
    InclusionValueShape<TIncludes>
>

type DefineEntityInput<
  TSchema extends z.ZodType,
  TExtends extends Record<string, Entity>,
  TIncludes extends Record<string, EntityIncludeRef>,
> = DistributiveSimplify<
  z.input<MakeEntitySchema<AddSchemaExtensions<TSchema, TExtends>>> & InclusionInputShape<TIncludes>
>

type MakeEntitySchema<TSchema extends z.ZodTypeAny> = z.ZodIntersection<
  TSchema,
  typeof entityWithMetaSchema
>

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

export type EntityIncludeRef =
  | Entity
  | { entity: Entity; multiple?: boolean; required?: boolean }
  | { entity: () => Entity; multiple?: boolean; required?: boolean }

type EntityIncludeObjectRef = Exclude<EntityIncludeRef, Entity>

function isEntityIncludeRef(value: EntityIncludeRef): value is EntityIncludeObjectRef {
  if (typeof value !== "object" || value === null || !("entity" in value)) {
    return false
  }

  const entity = (value as { entity: unknown }).entity
  return typeof entity === "function" || isEntity(entity)
}

type InclusionShape<TImplements extends Record<string, EntityIncludeRef>> = {
  -readonly [K in keyof TImplements]: TImplements[K] extends {
    entity: () => infer E
    multiple?: infer M
    required?: infer R
  }
    ? M extends true
      ? R extends false
        ? z.ZodDefault<z.ZodArray<z.ZodType<EntityValue<E>>>>
        : z.ZodArray<z.ZodType<EntityValue<E>>>
      : R extends false
        ? z.ZodOptional<z.ZodType<EntityValue<E>>>
        : z.ZodType<EntityValue<E>>
    : TImplements[K] extends {
          entity: infer E
          multiple?: infer M
          required?: infer R
        }
      ? M extends true
        ? R extends false
          ? z.ZodDefault<z.ZodArray<z.ZodType<EntityValue<E>>>>
          : z.ZodArray<z.ZodType<EntityValue<E>>>
        : R extends false
          ? z.ZodOptional<z.ZodType<EntityValue<E>>>
          : z.ZodType<EntityValue<E>>
      : TImplements[K] extends Entity
        ? z.ZodType<EntityValue<TImplements[K]>>
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

type AddIncludeExtensions<
  TIncludes extends Record<string, EntityIncludeRef>,
  TExtends extends Record<string, Entity>,
> = TExtends extends Record<string, never>
  ? TIncludes
  : IsEmptyObject<TExtends> extends true
    ? TIncludes
    : {
        [K in keyof TExtends]: AddIncludeExtensions<
          TIncludes & ExtractEntityIncludes<TExtends[K][typeof entityIncludes]>,
          Omit<TExtends, K>
        >
      }[keyof TExtends]

type ExtractEntityIncludes<T> = T extends Record<string, EntityIncludeRef>
  ? T
  : Record<string, never>

type AddSchemaInclusions<
  TSchema extends z.ZodTypeAny,
  TImplements extends Record<string, EntityIncludeRef>,
> = TImplements extends Record<string, never>
  ? TSchema
  : z.ZodIntersection<TSchema, z.ZodObject<InclusionShape<TImplements>>>

export function defineEntity<
  TType extends VersionedName,
  TSchema extends z.ZodType,
  const TExtends extends Record<string, Entity> = Record<string, never>,
  const TIncludes extends Record<string, EntityIncludeRef> = Record<never, never>,
>(
  options: EntityOptions<TType, TSchema, TExtends, TIncludes>,
): Entity<
  TType,
  Simplify<AddTypeExtensions<{ [K in TType]: true }, TExtends>>,
  MakeEntitySchema<AddSchemaExtensions<AddSchemaInclusions<TSchema, TIncludes>, TExtends>>,
  DefineEntityValue<TSchema, TExtends, AddIncludeExtensions<TIncludes, TExtends>>,
  DefineEntityInput<TSchema, TExtends, AddIncludeExtensions<TIncludes, TExtends>>,
  AddIncludeExtensions<TIncludes, TExtends>
> {
  try {
    entityModelSchema.shape.type.parse(options.type)
  } catch (error) {
    throw new Error(`Invalid entity type "${options.type}"`, { cause: error })
  }

  if (!options.schema) {
    throw new Error("Entity schema is required")
  }

  type IncludeRef = {
    field: string
    required: boolean
    multiple: boolean
    getEntity: () => Entity
  }

  const includeRefs: IncludeRef[] = Object.entries(options.includes ?? {}).map(
    ([field, entityRef]) => {
      if (isEntityIncludeRef(entityRef)) {
        const required = entityRef.required ?? true
        const multiple = entityRef.multiple ?? false

        let getEntity: () => Entity

        if (typeof entityRef.entity === "function") {
          const entity = entityRef.entity
          getEntity = entity
        } else {
          const entity = entityRef.entity
          getEntity = () => entity
        }

        return { field, required, multiple, getEntity }
      }

      const getEntity = () => entityRef
      return { field, required: true, multiple: false, getEntity }
    },
  )

  const inclusionShape = includeRefs.reduce(
    (shape, includeRef) => {
      let schema: z.ZodTypeAny = z.lazy(() => includeRef.getEntity().schema)

      if (includeRef.multiple) {
        schema = includeRef.required ? schema.array().min(1) : schema.array().default([])
      } else {
        schema = includeRef.required ? schema : schema.optional()
      }

      shape[includeRef.field] = schema
      return shape
    },
    {} as Record<string, z.ZodTypeAny>,
  )

  let finalSchema = Object.values(options.extends ?? {}).reduce(
    (schema, entity) => z.intersection(schema, entity.schema),
    options.schema as z.ZodType,
  )

  if (includeRefs.length > 0) {
    finalSchema = z.intersection(finalSchema, z.object(inclusionShape))
  }

  finalSchema = z.intersection(finalSchema, entityWithMetaSchema)

  const directInclusions = () =>
    includeRefs.map(includeRef => ({
      type: includeRef.getEntity().type,
      required: includeRef.required,
      multiple: includeRef.multiple,
      field: includeRef.field,
    }))
  const directExtensions = Object.values(options.extends ?? {}).map(entity => entity.type)

  const getInclusions = () => {
    const incs = [...directInclusions()]

    for (const entity of Object.values(options.extends ?? {})) {
      if (entity.model.inclusions) {
        incs.push(...entity.model.inclusions)
      }
    }

    return incs
  }

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
        get inclusions() {
          const incs = getInclusions()
          return incs.length > 0 ? incs : undefined
        },
        get directInclusions() {
          const incs = directInclusions()
          return incs.length > 0 ? incs : undefined
        },
        get schema() {
          if (!_schema) {
            // TODO: forbid unrepresentable types (and find way to filter out "undefined" literals)
            const rawSchema = z.toJSONSchema(finalSchema, {
              target: "draft-7",
              unrepresentable: "any",
            })

            _schema = fixJsonSchema(rawSchema) as z.core.JSONSchema.BaseSchema
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
   * The globally unique identity of the entity.
   *
   * Anonymous entities are forbidden.
   */
  identity: z.string(),

  /**
   * The IDs of the entities to reference by this entity.
   * Must already exist in the system (or be at least defined by this unit).
   */
  references: z.record(z.string(), z.string().array()).optional(),

  ...objectMetaSchema.pick({
    title: true,
    description: true,
    icon: true,
    iconColor: true,
  }).shape,
})

export type EntityMeta = z.infer<typeof entityMetaSchema>

export const entityWithMetaSchema = z.object({
  $meta: entityMetaSchema,
})

export type EntityWithMeta = z.infer<typeof entityWithMetaSchema>

export type EntityWithRequiredMeta = EntityWithMeta & {
  $meta: EntityMeta
}

const entityIdCache = new WeakMap<EntityWithMeta, string>()
const entityIdNamespace = "3cd37048-7c50-43a9-a2b9-ff7ff2b5ee79"

/**
 * Gets the unique ID of an entity based on its type and identity.
 *
 * The ID is generated using a hash of the entity's type and identity, and is cached for future retrievals.
 *
 * @param entity The entity to get the ID for.
 * @returns The unique ID of the entity.
 */
export function getEntityId(entity: EntityWithMeta): string {
  if (!entity.$meta) {
    throw new Error("Entity $meta is required to generate an entity id")
  }

  const existingId = entityIdCache.get(entity)

  if (existingId) {
    return existingId
  }

  const { type, identity } = entity.$meta

  const id = cuidv2d(entityIdNamespace, `${type}:${identity}`)
  entityIdCache.set(entity, id)

  return id
}
