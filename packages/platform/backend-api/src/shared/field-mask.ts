import type { Message } from "@bufbuild/protobuf"
import type { GenMessage } from "@bufbuild/protobuf/codegenv2"
import type { FieldMask } from "@bufbuild/protobuf/wkt"
import { Code, type ConnectError } from "@connectrpc/connect"
import { createApiError } from "./api-error"

/**
 * Validates and normalizes a request update mask.
 *
 * @param mask The update mask to validate.
 * @param schema The protobuf schema used to normalize field names.
 * @param mutablePaths The set of fields that may be updated.
 * @returns The normalized mutable field paths.
 */
export function validateUpdateMask<T extends Message>(
  mask: FieldMask | undefined,
  schema: GenMessage<T>,
  mutablePaths: ReadonlySet<string>,
): string[] {
  if (!mask || mask.paths.length === 0) {
    throw fieldMaskError("update_mask", "REQUIRED", "The update mask must not be empty")
  }

  const paths = new Set<string>()
  for (const path of mask.paths) {
    const normalized = normalizePath(schema, path)
    if (!mutablePaths.has(normalized)) {
      throw fieldMaskError(
        `update_mask.paths`,
        "IMMUTABLE_OR_UNKNOWN",
        `The path "${path}" is unknown, immutable, output-only, or traverses a collection`,
      )
    }
    paths.add(normalized)
  }

  return [...paths]
}

function normalizePath<T extends Message>(schema: GenMessage<T>, path: string): string {
  if (!path || path === "*") return path

  let descriptor = schema
  const normalized: string[] = []
  const segments = path.split(".")

  for (const [index, segment] of segments.entries()) {
    const field = descriptor.fields.find(
      candidate =>
        candidate.name === segment ||
        candidate.localName === segment ||
        candidate.jsonName === segment,
    )
    if (!field) return path

    normalized.push(field.name)
    if (index === segments.length - 1) break
    if (field.fieldKind !== "message" || !field.message) return path

    descriptor = field.message as GenMessage<T>
  }

  return normalized.join(".")
}

/**
 * Creates an API error describing an invalid update-mask field.
 *
 * @param field The field containing the violation.
 * @param reason The reason the field is invalid.
 * @param description The human-readable explanation of the violation.
 * @returns The API error describing the invalid field.
 */
export function fieldMaskError(field: string, reason: string, description: string): ConnectError {
  return createApiError({
    message: "Invalid update mask",
    code: Code.InvalidArgument,
    reason: "UPDATE_MASK_INVALID",
    fieldViolations: [{ field, reason, description }],
  })
}
