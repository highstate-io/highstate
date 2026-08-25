import type { PageRequest, PageResult } from "../shared/models/pagination"
import { createHash } from "node:crypto"
import { z } from "zod"
import { InvalidPageSizeError, InvalidPageTokenError } from "../shared/models/errors"

export type ResolvedPageRequest<TCursor> = {
  pageSize: number
  cursor?: TCursor
}

export type DatabasePageQuery<TCursor> = {
  cursor?: TCursor
  take: number
}

type DatabasePageOptionsBase<TRow, TCursor> = {
  collection: string
  request: PageRequest
  query: unknown
  cursorSchema: z.ZodType<TCursor>
  fetch: (query: DatabasePageQuery<TCursor>) => Promise<TRow[]>
  cursor: (row: TRow) => TCursor
}

export type DatabasePageOptions<TRow, TOutput, TCursor> =
  | (DatabasePageOptionsBase<TRow, TCursor> & { map?: undefined })
  | (DatabasePageOptionsBase<TRow, TCursor> & { map: (row: TRow) => TOutput })

const pageTokenSchema = z.object({
  version: z.literal(1),
  collection: z.string().min(1),
  query: z.string().length(64),
  cursor: z.unknown(),
})

/**
 * Resolves and validates a cursor page request.
 *
 * @param collection The stable identity of the collection.
 * @param request The requested page size and opaque continuation token.
 * @param query The complete effective query, including parent scope and filters.
 * @param cursorSchema The schema for the collection's ordering cursor.
 * @returns The effective page size and validated ordering cursor.
 */
export function resolvePageRequest<TCursor>(
  collection: string,
  request: PageRequest,
  query: unknown,
  cursorSchema: z.ZodType<TCursor>,
): ResolvedPageRequest<TCursor> {
  const pageSize = Math.min(request.pageSize ?? 20, 100)
  if (!Number.isInteger(pageSize) || pageSize < 0) {
    throw new InvalidPageSizeError(request.pageSize ?? 0)
  }

  if (!request.pageToken) {
    return { pageSize }
  }

  try {
    const token = pageTokenSchema.parse(
      JSON.parse(Buffer.from(request.pageToken, "base64url").toString("utf8")),
    )
    if (token.collection !== collection) {
      throw new InvalidPageTokenError(collection, "COLLECTION_MISMATCH")
    }

    if (token.query !== fingerprintPageQuery(query)) {
      throw new InvalidPageTokenError(collection, "QUERY_MISMATCH")
    }

    return { pageSize, cursor: cursorSchema.parse(token.cursor) }
  } catch (error) {
    if (error instanceof InvalidPageTokenError) {
      throw error
    }

    throw new InvalidPageTokenError(collection, "MALFORMED")
  }
}

/**
 * Encodes a collection continuation cursor as an opaque URL-safe token.
 *
 * @param collection The stable identity of the collection.
 * @param query The complete effective query, including parent scope and filters.
 * @param cursor The complete deterministic ordering cursor.
 * @returns The opaque continuation token.
 */
export function encodePageToken(collection: string, query: unknown, cursor: unknown): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      collection,
      query: fingerprintPageQuery(query),
      cursor,
    }),
  ).toString("base64url")
}

/**
 * Builds a page result from a collection fetched with one extra item.
 *
 * @param items The fetched items, including an optional extra item.
 * @param pageSize The effective page size.
 * @param encodeCursor The function that encodes the last returned item.
 * @returns The bounded items and an optional continuation token.
 */
export function toPageResult<T>(
  items: T[],
  pageSize: number,
  encodeCursor: (item: T) => string,
): PageResult<T> {
  const hasMore = items.length > pageSize
  const pageItems = hasMore ? items.slice(0, pageSize) : items
  const lastItem = pageItems.at(-1)

  return {
    items: pageItems,
    nextPageToken: hasMore && lastItem ? encodeCursor(lastItem) : undefined,
  }
}

/**
 * Executes a bounded database page query and creates its continuation token.
 *
 * @param options The database query, cursor, and output mapping configuration.
 * @returns The requested collection page.
 */
export function queryDatabasePage<TRow, TCursor = unknown>(
  options: DatabasePageOptionsBase<TRow, TCursor> & { map?: undefined },
): Promise<PageResult<TRow>>
export function queryDatabasePage<TRow, TOutput, TCursor = unknown>(
  options: DatabasePageOptionsBase<TRow, TCursor> & { map: (row: TRow) => TOutput },
): Promise<PageResult<TOutput>>
export async function queryDatabasePage<TRow, TCursor = unknown>(
  options: DatabasePageOptions<TRow, unknown, TCursor>,
): Promise<PageResult<unknown>> {
  const effectiveQuery = stripPageRequest(options.query)
  const { pageSize, cursor } = resolvePageRequest(
    options.collection,
    options.request,
    effectiveQuery,
    options.cursorSchema,
  )
  const rows = await options.fetch({ cursor, take: pageSize + 1 })
  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const lastRow = pageRows.at(-1)
  const items = options.map ? pageRows.map(options.map) : pageRows

  return {
    items,
    nextPageToken:
      hasMore && lastRow
        ? encodePageToken(options.collection, effectiveQuery, options.cursor(lastRow))
        : undefined,
  }
}

function stripPageRequest(query: unknown): unknown {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return query
  }

  const { pageSize: _, pageToken: __, ...effectiveQuery } = query as Record<string, unknown>
  return effectiveQuery
}

function fingerprintPageQuery(query: unknown): string {
  return createHash("sha256").update(stableStringify(query)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`
  }

  return JSON.stringify(value) ?? "null"
}
