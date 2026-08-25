import type { CollectionQuery } from "../../../shared"

export function buildSettingsOrderBy(
  query: CollectionQuery,
  defaultField: string,
): Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[] {
  if (!query.sortBy || query.sortBy.length === 0) {
    return [{ [defaultField]: "desc" }, { id: "asc" }]
  }

  if (query.sortBy.length === 1) {
    const sort = query.sortBy[0]
    return sort
      ? [{ [sort.key]: sort.order }, { id: "asc" }]
      : [{ [defaultField]: "desc" }, { id: "asc" }]
  }

  return [...query.sortBy.map(sort => ({ [sort.key]: sort.order })), { id: "asc" }]
}
