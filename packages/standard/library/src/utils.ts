import { type FullComponentArgumentOptions, genericNameSchema, z } from "@highstate/contract"
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

export const booleanPatchSchema = z.enum(["keep", "true", "false"]).default("keep")

/**
 * The boolean patch:
 *
 * - `keep`: keep the existing value;
 * - `true`: set the value to `true`;
 * - `false`: set the value to `false`.
 */
export type BooleanPatch = z.infer<typeof booleanPatchSchema>

export function toPatchArgs<T extends Record<string, FullComponentArgumentOptions>>(
  args: T,
): {
  [K in keyof T]: T[K]["schema"] extends z.ZodBoolean
    ? Omit<T[K], "schema"> & { schema: typeof booleanPatchSchema }
    : T[K]
} {
  return mapValues(args, arg => {
    if (
      arg.schema instanceof z.ZodBoolean ||
      (arg.schema instanceof z.ZodDefault && arg.schema.unwrap() instanceof z.ZodBoolean) ||
      (arg.schema instanceof z.ZodOptional && arg.schema.unwrap() instanceof z.ZodBoolean)
    ) {
      return { ...arg, schema: booleanPatchSchema }
    }

    return arg
    // biome-ignore lint/suspicious/noExplicitAny: already typed
  }) as any
}

/**
 * The schema for a metadata key.
 *
 * Follows the same conventions as Highstate generic name, but requires at least two segments separated by a dot.
 */
export const metadataKeySchema = z.templateLiteral([
  genericNameSchema,
  z.literal("."),
  genericNameSchema,
])

export const metadataSchema = z.record(metadataKeySchema, z.unknown())

export type Metadata = z.infer<typeof metadataSchema>
export type MetadataKey = z.infer<typeof metadataKeySchema>
export type MetadataContainer = { metadata?: Metadata }
