import { type Input, type Output, output, type Unwrap } from "@pulumi/pulumi"

/**
 * The input type for an array of inputs.
 * The same as `Input<Input<T>[]>`, but more readable.
 */
export type InputArray<T> = Input<Input<T>[]>

/**
 * The input type for a record of inputs.
 * The same as `Input<Record<string, Input<T>>>`, but more readable.
 */
export type InputRecord<T> = Input<Record<string, Input<T>>>

/**
 * The input or input array type for a value.
 */
export type InputOrArray<T> = Input<T> | InputArray<T>

type LeafValue = string | number | boolean | null | undefined
type IsUnknown<T> = unknown extends T ? (T extends unknown ? true : false) : false

/**
 * The recursive input type for a value.
 */
export type DeepInput<T> = [T] extends [LeafValue]
  ? Input<T>
  : IsUnknown<T> extends true
    ? Input<unknown>
    : Input<{ [K in keyof T]: DeepInput<T[K]> }>

/**
 * Transforms an input value to a promise that resolves to the unwrapped value.
 *
 * @param input The input value to transform.
 * @returns A promise that resolves to the unwrapped value.
 */
export function toPromise<T>(input: Input<T>): Promise<Unwrap<T>> {
  return new Promise(resolve => output(input).apply(resolve))
}

/**
 * Receives an item and a collection, and returns an array containing the item and the collection.
 *
 * Excludes the item if it is undefined.
 *
 * @param item The single item input.
 * @param collection The collection of items input.
 */
export function normalize<T>(item: T | undefined, collection: T[] | undefined): T[] {
  if (item && collection) {
    return [item, ...collection]
  }

  if (item) {
    return [item]
  }

  return collection ?? []
}

/**
 * The same as `normalize`, but accepts inputs and returns output.
 *
 * @param item The single item input.
 * @param collection The collection of items input.
 */
export function normalizeInputs<T>(
  item: Input<T> | undefined,
  collection: InputArray<T> | undefined,
): Output<Unwrap<T>[]> {
  return (
    output({ item, collection })
      //
      .apply(({ item, collection }) => normalize(item, collection)) as Output<Unwrap<T>[]>
  )
}

/**
 * The convenience function to normalize inputs and map them to a new type.
 *
 * @param item The single item input.
 * @param collection The collection of items input.
 * @param mapFn The function to map each item to a new type.
 */
export function normalizeInputsAndMap<T, U>(
  item: Input<T> | undefined,
  collection: InputArray<T> | undefined,
  mapFn: (value: Unwrap<T>) => U,
): Output<U[]> {
  return normalizeInputs(item, collection).apply(values => values.map(mapFn))
}

/**
 * Applies a function to the input and returns an output.
 *
 * Can be used in `remeda` pipelines.
 *
 * @param fn The function to apply to the input.
 */
export function apply<T, U>(fn: (value: Unwrap<T>) => U): (input: Input<T>) => Output<U> {
  return input => output(input).apply(fn)
}
