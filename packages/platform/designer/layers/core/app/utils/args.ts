import type z from "zod"

export function isComplexSchema(schema: z.core.JSONSchema.BaseSchema): boolean {
  if (schema.type === "object") {
    return true
  }

  if (schema.type === "array" && !!schema.items && !Array.isArray(schema.items)) {
    return isComplexSchema(schema.items as z.core.JSONSchema.BaseSchema)
  }

  return false
}

export function renderArgumentValue(value: unknown, schema: z.core.JSONSchema.BaseSchema): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]"
    }

    return "[...]"
  }

  if (typeof value === "object") {
    return "{...}"
  }

  if (typeof value === "string" && schema.language) {
    return "..."
  }

  return String(value)
}
