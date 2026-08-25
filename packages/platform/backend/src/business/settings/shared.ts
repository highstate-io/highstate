import type { CollectionQuery, PageResult } from "../../shared"
import { z } from "zod"
import { queryDatabasePage } from "../../common"

type SettingsPageQuery = {
  cursorId?: string
  take: number
}

type SettingsPageOptionsBase<TRow extends { id: string }> = {
  collection: string
  request: CollectionQuery
  query: unknown
  fetch: (query: SettingsPageQuery) => Promise<TRow[]>
}

/**
 * Executes a settings collection query using a database cursor.
 *
 * @param options The bounded database query and output mapping configuration.
 * @returns The requested settings collection page.
 */
export function querySettingsPage<TRow extends { id: string }>(
  options: SettingsPageOptionsBase<TRow> & { map?: undefined },
): Promise<PageResult<TRow>>
export function querySettingsPage<TRow extends { id: string }, TOutput>(
  options: SettingsPageOptionsBase<TRow> & { map: (row: TRow) => TOutput },
): Promise<PageResult<TOutput>>
export async function querySettingsPage<TRow extends { id: string }>(
  options: SettingsPageOptionsBase<TRow> & { map?: (row: TRow) => unknown },
): Promise<PageResult<unknown>> {
  if (options.map) {
    return await queryDatabasePage({
      collection: options.collection,
      request: options.request,
      query: options.query,
      cursorSchema: z.object({ id: z.string().min(1) }),
      fetch: async ({ cursor, take }) => await options.fetch({ cursorId: cursor?.id, take }),
      cursor: row => ({ id: row.id }),
      map: options.map,
    })
  }

  return await queryDatabasePage({
    collection: options.collection,
    request: options.request,
    query: options.query,
    cursorSchema: z.object({ id: z.string().min(1) }),
    fetch: async ({ cursor, take }) => await options.fetch({ cursorId: cursor?.id, take }),
    cursor: row => ({ id: row.id }),
  })
}
