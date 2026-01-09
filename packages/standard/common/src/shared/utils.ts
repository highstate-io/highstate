import type { LabelContainer } from "@highstate/library"
import { compile } from "filter-expression"
import { setPath } from "remeda"

/**
 * Filter a list of items by their labels using a filter expression.
 *
 * See [filter-expression](https://github.com/tronghieu/filter-expression?tab=readme-ov-file#language) for more details on the expression syntax.
 *
 * @param items The items to filter.
 * @param expression The filter expression.
 * @param getLabels The function to get the labels of an item. Defaults to getting the `labels` property.
 * @returns The filtered items.
 */
export function filterByLabels<T extends LabelContainer>(
  items: T[],
  expression: string,
  getLabels = (item: T) => item.labels,
): T[] {
  const { evaluate } = compile(expression)

  return items.filter(item => {
    const labels = getLabels(item)
    if (!labels) return false

    const entry = {}
    for (const [key, value] of Object.entries(labels)) {
      // biome-ignore lint/suspicious/noExplicitAny: setPath behaves incorrectly in generic context
      ;(setPath as any)(entry, key.split("."), value)
    }

    return evaluate(entry)
  })
}
