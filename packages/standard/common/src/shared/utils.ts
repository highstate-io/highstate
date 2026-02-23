import type { Metadata, MetadataContainer, BooleanPatch } from "@highstate/library"
import {
  cuidv2d,
  getEntityId,
  HighstateSignature,
  z,
  type Entity,
  type EntityValueInput,
  type EntityMeta,
  type EntityWithMeta,
  type VersionedName,
  type EntityValue,
} from "@highstate/contract"
import { compile } from "filter-expression"
import { createHash } from "node:crypto"
import {
  output,
  toPromise,
  type DeepInput,
  type Output,
  type Input,
  type InputArray,
  type Unwrap,
} from "@highstate/pulumi"
import type { T } from "vitest/dist/chunks/environment.d.cL3nLXbE.js"

/**
 * Filter a list of items using a filter expression.
 *
 * See [filter-expression](https://github.com/tronghieu/filter-expression?tab=readme-ov-file#language) for more details on the expression syntax.
 *
 * @param items The items to filter.
 * @param expression The filter expression.
 * @param getContext The function to get the context for each item. Defaults to the item itself.
 * @returns The filtered items.
 */
export function filterByExpression<T>(
  items: T[],
  expression: string,
  getContext = (item: T) => item as Record<string, unknown>,
): T[] {
  const { evaluate } = compile(expression)

  return items.filter(item => evaluate(getContext(item)))
}

/**
 * Filter a list of items with metadata using a filter expression.
 *
 * See `filterByExpression` for more details.
 *
 * @param items The items to filter.
 * @param expression The filter expression.
 * @param getContext The function to get the context for each item. Defaults to the item itself.
 * @returns The filtered items.
 */
export function filterWithMetadataByExpression<T extends MetadataContainer>(
  items: T[],
  expression: string,
  getContext = (item: T) => item as Record<string, unknown>,
): T[] {
  return filterByExpression(items, expression, item =>
    getContext({ ...item, metadata: item.metadata ? flattenMetadata(item.metadata) : undefined }),
  )
}

/**
 * Transforms each dot-separated key in the metadata into a nested object structure.
 *
 * Should be used to create valid context for `filterByExpression`.
 *
 * Example:
 *
 * ```ts
 * const metadata = {
 *   "k8s.service": {}
 * }
 * ```
 *
 * becomes
 *
 * ```ts
 * const flattened = {
 *   k8s: {
 *     service: {}
 *   }
 * }
 * ```
 *
 * @param metadata The metadata to flatten.
 * @returns The flattened metadata.
 */
export function flattenMetadata(metadata: Metadata): Record<string, unknown> {
  const result = {}

  for (const [key, value] of Object.entries(metadata)) {
    const path = key.split(".")
    // biome-ignore lint/suspicious/noExplicitAny: to simplify implementation
    let current: any = result

    for (let i = 0; i < path.length; i++) {
      const segment = path[i]

      if (i === path.length - 1) {
        current[segment] = value
      } else {
        if (!(segment in current)) {
          current[segment] = {}
        }
        current = current[segment] as Record<string, unknown>
      }
    }
  }

  return result
}

export function applyBooleanPatch<T extends boolean>(value: T, patch: BooleanPatch): T {
  switch (patch) {
    case "true":
      return true as T
    case "false":
      return false as T
    case "keep":
      return value
  }
}

/**
 * Parses a human-readable size string (e.g., "10MB", "5GB") into its equivalent number of bytes.
 *
 * @param size The size string to parse.
 * @returns The equivalent number of bytes.
 * @throws Will throw an error if the input string is not in a valid format or contains an invalid unit.
 */
export function parseSizeString(size: string): number {
  const units: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
    pb: 1024 ** 5,
    eb: 1024 ** 6,
    zb: 1024 ** 7,
    yb: 1024 ** 8,
  }

  const match = size
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/)

  if (!match) {
    throw new Error(`Invalid size string: ${size}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2] || "b"

  if (!(unit in units)) {
    throw new Error(`Invalid size unit: ${unit}`)
  }

  return Math.round(value * units[unit])
}

export type MakeEntityOptions<TEntity extends Entity> = {
  entity: TEntity
  identity: string
  meta?: Omit<EntityMeta, "type" | "identity">
  value: Omit<EntityValueInput<TEntity>, "$meta">
}

export function makeEntity<TEntity extends Entity>({
  entity,
  identity,
  meta,
  value,
}: MakeEntityOptions<TEntity>): EntityValue<TEntity> {
  const built = {
    ...(value as Record<string, unknown>),
    $meta: {
      type: entity.type,
      identity,
      ...meta,
    },
  }

  return entity.schema.parse(built) as EntityValue<TEntity>
}

type CommonEntityMeta = Omit<EntityMeta, "type" | "identity">

export type MakeEntityAsyncOptions<TEntity extends Entity> = {
  entity: TEntity
  identity: Input<string>
  meta?: { [K in keyof CommonEntityMeta]?: Input<CommonEntityMeta[K]> }
  value: {
    [K in keyof Omit<EntityValueInput<TEntity>, "$meta">]: DeepInput<EntityValueInput<TEntity>[K]>
  }
}

export function makeEntityOutput<TEntity extends Entity>({
  entity,
  identity,
  meta,
  value,
}: MakeEntityAsyncOptions<TEntity>): Output<EntityValue<TEntity>> {
  return output({
    ...value,
    $meta: {
      type: entity.type,
      identity,
      ...meta,
    },
  }).apply(built => entity.schema.parse(built)) as Output<EntityValue<TEntity>>
}

export function makeEntityAsync<TEntity extends Entity>(
  options: MakeEntityAsyncOptions<TEntity>,
): Promise<EntityValue<TEntity>> {
  return toPromise(makeEntityOutput(options)) as Promise<EntityValue<TEntity>>
}

/**
 * Get the combined identity based on the ids of the given entities.
 *
 * This function can be used for entities that do not have their own identity but are defined by the combination of other entities (e.g. a server defined by its network endpoints).
 */
export function getCombinedIdentity(entities: EntityWithMeta[]): string {
  const sortedIds = entities.map(getEntityId).sort() // sort to ensure consistent identity regardless of the order of entities

  return sortedIds.join(":")
}

export function getCombinedIdentityOutput(entities: InputArray<EntityWithMeta>): Output<string> {
  return output(entities).apply(getCombinedIdentity)
}

export function getCombinedIdentityAsync(entities: EntityWithMeta[]): Promise<string> {
  return toPromise(getCombinedIdentityOutput(entities))
}
