import type { z } from "zod"
import { isNonNullish, pickBy } from "remeda"

type PickUndefinedKeys<T extends Record<string, unknown>> = T extends Record<string, never>
  ? never
  : Exclude<
      {
        [K in keyof T]: undefined extends T[K] ? K : never
      }[keyof T],
      undefined
    >

type AllOptionalKeys<T extends Record<string, unknown>> = T extends Record<string, never>
  ? never
  : Exclude<
      {
        [K in keyof T]: undefined extends T[K] ? K : never
      }[keyof T],
      undefined
    >

type HasRequired<T extends Record<string, unknown>> = T extends Record<string, never>
  ? false
  : [keyof T] extends [AllOptionalKeys<T>]
    ? false
    : true

type PickRecordsWithAnyRequired<T extends Record<string, Record<string, unknown>>> =
  T extends Record<string, never>
    ? never
    : Exclude<
        {
          [K in keyof T]: HasRequired<T[K]> extends true ? K : never
        }[keyof T],
        undefined
      >

export type OptionalEmptyRecords<T extends Record<string, Record<string, unknown>>> = {
  [K in Exclude<keyof T, PickRecordsWithAnyRequired<T>>]?: OptionalUndefinedFields<T[K]>
} & {
  [K in PickRecordsWithAnyRequired<T>]: OptionalUndefinedFields<T[K]>
}

export type OptionalUndefinedFields<T extends Record<string, unknown>> = {
  [K in PickUndefinedKeys<T>]?: T[K]
} & {
  [K in Exclude<keyof T, PickUndefinedKeys<T>>]: T[K]
}

/**
 * Marks specific keys in a type as optional.
 *
 * @template T The type to modify.
 * @template K The keys to make optional.
 */
export type PartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Marks specific keys in a type as required.
 *
 * @template T The type to modify.
 * @template K The keys to make required.
 */
export type RequiredKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

/**
 * Formats a multiline string and trims the indentation.
 *
 * @param str The string to trim.
 * @returns The trimmed string.
 */
export function text(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Convert all values to strings
  const stringValues = values.map(String)

  // Build full string with values interpolated
  let result = ""
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < stringValues.length) {
      const value = stringValues[i]
      const lines = value.split("\n")
      const lastLineIndentMatch = strings[i].match(/(?:^|\n)([ \t]*)$/)
      const indent = lastLineIndentMatch ? lastLineIndentMatch[1] : ""

      result += lines.map((line, j) => (j === 0 ? line : indent + line)).join("\n")
    }
  }

  return trimIndentation(result)
}

/**
 * Removes the indentation from a multiline string.
 *
 * @param text The text to trim.
 * @returns The trimmed text.
 */
export function trimIndentation(text: string): string {
  const lines = text.split("\n")
  const indent = lines
    .filter(line => line.trim() !== "")
    .map(line => line.match(/^\s*/)?.[0].length ?? 0)
    .reduce((min, indent) => Math.min(min, indent), Infinity)

  return lines
    .map(line => line.slice(indent))
    .join("\n")
    .trim()
}

/**
 * Converts bytes to a human-readable format.
 *
 * @param bytes The number of bytes.
 * @returns The human-readable string representation of the bytes.
 */
export function bytesToHumanReadable(bytes: number): string {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  if (bytes === 0) return "0 Bytes"

  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * Checks if a value matches the given Zod schema and narrows the type accordingly.
 *
 * @param schema The Zod schema to check against.
 * @param value The value to check.
 * @returns `true` if the value matches the schema, `false` otherwise.
 */
export function check<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): value is z.infer<TSchema> {
  return schema.safeParse(value).success
}

/**
 * Gets or creates a value in a map, using a factory function if the key does not exist.
 *
 * @param map The map to check.
 * @param key The key to look for.
 * @param createFn The function to create a new value if the key does not exist.
 * @returns The value associated with the key.
 */
export function getOrCreate<TKey, TValue>(
  map: Map<TKey, TValue>,
  key: TKey,
  createFn: (key: TKey) => TValue,
): TValue {
  const existing = map.get(key)
  if (existing !== undefined) {
    return existing
  }

  const value = createFn(key)
  map.set(key, value)
  return value
}

/**
 * Strips nullish values from an object.
 *
 * @param obj The object to strip.
 * @returns A new object with all nullish values removed.
 */
export function stripNullish<T extends Record<string, unknown>>(obj: T) {
  return pickBy(obj, isNonNullish)
}
