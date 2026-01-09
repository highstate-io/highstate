import { $args, genericNameSchema, z } from "@highstate/contract"
import { mapValues } from "remeda"

type PrefixWith<TString extends string, TPrefix extends string> = TPrefix extends ""
  ? TString
  : `${TPrefix}${Capitalize<TString>}`

function prefixWith<TString extends string, TPrefix extends string>(
  string: TString,
  prefix?: TPrefix,
): PrefixWith<TString, TPrefix> {
  return (
    prefix ? `${prefix}${string.charAt(0).toUpperCase()}${string.slice(1)}` : string
  ) as PrefixWith<TString, TPrefix>
}

type PrefixedKeys<T extends Record<string, unknown>, Prefix extends string> = {
  [K in keyof T as PrefixWith<Extract<K, string>, Prefix>]: T[K]
}

/**
 * The helper function to prefix the keys of an object with a given prefix.
 *
 * If the prefix is not provided, the keys will not be modified.
 *
 * All keys after prefixing will be capitalized.
 *
 * @param prefix The prefix to use. If not provided, the keys will not be modified.
 * @param obj The object to prefix the keys of.
 * @returns The object with prefixed keys.
 */
export function prefixKeysWith<T extends Record<string, unknown>, Prefix extends string>(
  prefix: Prefix | undefined,
  obj: T,
): PrefixedKeys<T, Prefix> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [prefixWith(key, prefix), value]),
  ) as PrefixedKeys<T, Prefix>
}

export const arrayPatchModeSchema = z.enum(["prepend", "replace"])
export const booleanPatchSchema = z.enum(["keep", "true", "false"])

/**
 * The mode to use when patching some array:
 *
 * - `prepend`: prepend the values of the new array to the existing array;
 * - `replace`: replace the existing array with the new array.
 */
export type ArrayPatchMode = z.infer<typeof arrayPatchModeSchema>

/**
 * The boolean patch:
 *
 * - `keep`: keep the existing value;
 * - `true`: set the value to `true`;
 * - `false`: set the value to `false`.
 */
export type BooleanPatch = z.infer<typeof booleanPatchSchema>

/**
 * The schema for a label key.
 *
 * Follows the same conventions as Highstate generic name, but requires at least two segments separated by a dot.
 */
export const labelKeySchema = z.templateLiteral([
  genericNameSchema,
  z.literal("."),
  genericNameSchema,
])

export const labelValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export type LabelKey = z.infer<typeof labelKeySchema>
export type LabelValue = z.infer<typeof labelValueSchema>

export type Labels = Record<LabelKey, LabelValue>
export type LabelContainer = { labels?: Labels }

export const commonArgs = $args({
  /**
   * The labels associated with the entity.
   * Represents a set of key/value pairs with string keys and string/number/boolean values.
   *
   * Can be queried used simple query expressions.
   * See [filter-expression](https://github.com/tronghieu/filter-expression?tab=readme-ov-file#language)
   * for more details on the expression syntax.
   */
  labels: z.record(labelKeySchema, labelValueSchema).optional(),
})

export const commonArgsSchema = mapValues(commonArgs, x => x.schema)
