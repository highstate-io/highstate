import type { Metadata, MetadataContainer } from "@highstate/library"
import { compile } from "filter-expression"

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
