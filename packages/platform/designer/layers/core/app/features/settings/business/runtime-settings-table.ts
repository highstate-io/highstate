import type {
  CollectionQuery,
  CollectionQueryResult,
  RuntimeSettingsKind,
  RuntimeSettingsOutputs,
} from "@highstate/backend/shared"

type RuntimeSetting = RuntimeSettingsOutputs[RuntimeSettingsKind]

/**
 * Applies the shared settings table's search, sorting, and paging to loaded runtime settings.
 */
export function queryRuntimeSettings(
  items: RuntimeSetting[],
  search: string | null | undefined,
  sortBy: CollectionQuery["sortBy"],
  page: number,
  itemsPerPage: number,
): CollectionQueryResult<RuntimeSetting> & { total: number; hasNextPage: boolean } {
  const query = search?.trim().toLowerCase() ?? ""

  const filtered = items.filter(item =>
    [item.id, item.meta.title, item.meta.description].some(value =>
      value?.toLowerCase().includes(query),
    ),
  )

  const sorted = filtered.sort((left, right) => {
    for (const sort of sortBy ?? []) {
      const comparison =
        sort.key === "revision"
          ? left.revision - right.revision
          : (sort.key === "id" ? left.id : (left.meta.title ?? "")).localeCompare(
              sort.key === "id" ? right.id : (right.meta.title ?? ""),
            )

      if (comparison) {
        return sort.order === "desc" ? -comparison : comparison
      }
    }

    return 0
  })

  const start = (page - 1) * itemsPerPage
  return {
    items: sorted.slice(start, start + itemsPerPage),
    total: sorted.length,
    hasNextPage: start + itemsPerPage < sorted.length,
  }
}
