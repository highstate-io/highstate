import type { JsonObject } from "@bufbuild/protobuf"

/**
 * Converts a structured value into a protobuf JSON object.
 *
 * @param value The structured value to convert.
 * @returns The corresponding protobuf JSON object.
 */
export function toJsonObject(value: object): JsonObject {
  return normalizeJsonValue(value) as JsonObject
}

function normalizeJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (entry === undefined) {
          return []
        }

        return [[key, normalizeJsonValue(entry)]]
      }),
    )
  }

  return value
}
