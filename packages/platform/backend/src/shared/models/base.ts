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
   * The requested page size.
   *
   * Zero or omission uses the default of 20 and values above 100 are capped.
   */
  pageSize: z.number().int().nonnegative().default(0).optional(),

  /**
   * The opaque continuation token from a previous page.
   */
  pageToken: z.string().optional(),
})

export type CollectionQuery = z.infer<typeof collectionQuerySchema>

export type CollectionQueryResult<T> = {
  items: T[]
  nextPageToken?: string
}

export function collectionQueryResult<TSchema extends z.ZodType>(schema: TSchema) {
  return z.object({
    items: z.array(schema),
    nextPageToken: z.string().optional(),
  })
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
