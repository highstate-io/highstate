import type { ObjectMeta } from "@highstate/contract"
import { constant, mapValues } from "remeda"
import { z } from "zod"

export function hasObjectMeta(value: unknown): value is { meta: ObjectMeta } {
  return typeof value === "object" && value !== null && "meta" in value
}

const sortBySchema = z.object({
  key: z.string(),
  order: z.enum(["asc", "desc"]),
})

export type GenericEntity = {
  id: string
  meta: ObjectMeta
  createdAt?: Date
}

export const collectionQuerySchema = z.object({
  /**
   * The search string to filter documents by display name, description, or other text fields.
   */
  search: z.string().optional(),

  /**
   * The sorting configuration for the results.
   *
   * Can be a single sort field or an array of sort fields.
   * Each sort field contains the key and order.
   */
  sortBy: z.array(sortBySchema).optional(),

  /**
   * The number of items to skip.
   *
   * Defaults to 0 if not specified.
   */
  skip: z.number().int().nonnegative().default(0).optional(),

  /**
   * The count of documents to return.
   *
   * Defaults to 20 if not specified.
   * Maximum value is 100.
   */
  count: z.number().int().positive().max(100).default(20).optional(),
})

export type CollectionQuery = z.infer<typeof collectionQuerySchema>

export function collectionQueryResult<TSchema extends z.ZodType>(schema: TSchema) {
  return z.object({
    items: z.array(schema),
    total: z.number().int().nonnegative(),
  })
}

export type CollectionQueryResult<T> = {
  /**
   * The list of objects matching the query and restricted by pagination.
   */
  items: T[]

  /**
   * The total number of documents matching the query.
   */
  total: number
}

/**
 * Creates a selection object using the provided schema.
 *
 * It can be used in zod pick or prisma select.
 *
 * @param schema The Zod schema to create the selection object from.
 */
export function forSchema<TSchema extends z.ZodObject>(
  schema: TSchema,
): { [K in keyof TSchema["shape"]]: true } {
  return mapValues(schema.shape, constant(true)) as { [K in keyof TSchema["shape"]]: true }
}
