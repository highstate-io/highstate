import type { Metadata, MetadataContainer, BooleanPatch } from "@highstate/library"
import { cuidv2d, HighstateSignature, type EntityWithMeta } from "@highstate/contract"
import { compile } from "filter-expression"
import { createHash } from "node:crypto"

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
