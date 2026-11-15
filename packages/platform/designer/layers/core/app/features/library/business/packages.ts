import type { CollectionQuery } from "@highstate/backend/shared"
import { cuidv2d, type SelectedLibraryPackage } from "@highstate/contract"

/**
 * Queries package selections, including selections whose initial resolution has not succeeded yet.
 */
export function queryLibraryPackages(
  packages: SelectedLibraryPackage[],
  search: string | null | undefined,
  sortBy: CollectionQuery["sortBy"],
  page: number,
  itemsPerPage: number,
) {
  const query = search?.trim().toLowerCase() ?? ""
  const items = packages
    .filter(pkg => `${pkg.packageName} ${pkg.version}`.toLowerCase().includes(query))
    .map(pkg => ({
      ...pkg,
      id: cuidv2d("highstate.designer.library-package-selection", pkg.packageName),
      meta: { title: pkg.packageName },
    }))
    .sort((left, right) => {
      for (const sort of sortBy ?? []) {
        if (sort.key !== "meta.title" && sort.key !== "version") {
          continue
        }

        const comparison = (sort.key === "version" ? left.version : left.packageName).localeCompare(
          sort.key === "version" ? right.version : right.packageName,
          undefined,
          { numeric: true },
        )
        if (comparison) {
          return sort.order === "desc" ? -comparison : comparison
        }
      }

      return 0
    })
  const start = (page - 1) * itemsPerPage

  return {
    items: items.slice(start, start + itemsPerPage),
    total: items.length,
    hasNextPage: start + itemsPerPage < items.length,
  }
}
