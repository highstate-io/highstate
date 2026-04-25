function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Normalizes JSON schema produced by Zod exports.
 *
 * In particular, it merges intersections of object schemas represented as
 * `allOf: [{ type: "object", ... }, { type: "object", ... }, ...]` into a single
 * object schema so that validators treat `additionalProperties` consistently.
 */
export function fixJsonSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema
  }

  const allOf = schema.allOf
  if (Array.isArray(allOf) && allOf.length > 0) {
    const objectSchemas: Record<string, unknown>[] = []
    const otherSchemas: unknown[] = []

    for (const item of allOf) {
      if (isRecord(item) && item.type === "object") {
        objectSchemas.push(item)
        continue
      }

      otherSchemas.push(item)
    }

    if (objectSchemas.length > 1) {
      const required = new Set<string>()
      const properties: Record<string, unknown> = {}
      let additionalProperties: unknown

      for (const objectSchema of objectSchemas) {
        const objectRequired = objectSchema.required
        if (Array.isArray(objectRequired)) {
          for (const key of objectRequired) {
            if (typeof key === "string") {
              required.add(key)
            }
          }
        }

        const objectProperties = objectSchema.properties
        if (isRecord(objectProperties)) {
          for (const [key, value] of Object.entries(objectProperties)) {
            const existing = properties[key]
            if (existing === undefined) {
              properties[key] = value
              continue
            }

            properties[key] = { allOf: [existing, value] }
          }
        }

        if ("additionalProperties" in objectSchema) {
          if (additionalProperties === undefined) {
            additionalProperties = objectSchema.additionalProperties
          } else if (additionalProperties !== objectSchema.additionalProperties) {
            additionalProperties = false
          }
        }
      }

      const mergedObjectSchema: Record<string, unknown> = {
        type: "object",
        properties,
        ...(required.size > 0 ? { required: Array.from(required) } : {}),
        ...(additionalProperties !== undefined
          ? { additionalProperties }
          : { additionalProperties: false }),
      }

      const merged =
        otherSchemas.length === 0
          ? mergedObjectSchema
          : {
              ...schema,
              allOf: [mergedObjectSchema, ...otherSchemas],
            }

      return fixJsonSchema(merged)
    }
  }

  const next: Record<string, unknown> = { ...schema }

  if (Array.isArray(next.allOf)) {
    next.allOf = next.allOf.map(fixJsonSchema)
  }
  if (Array.isArray(next.anyOf)) {
    next.anyOf = next.anyOf.map(fixJsonSchema)
  }
  if (Array.isArray(next.oneOf)) {
    next.oneOf = next.oneOf.map(fixJsonSchema)
  }
  if (isRecord(next.properties)) {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, fixJsonSchema(value)]),
    )
  }
  if (isRecord(next.items)) {
    next.items = fixJsonSchema(next.items)
  } else if (Array.isArray(next.items)) {
    next.items = next.items.map(fixJsonSchema)
  }
  if (isRecord(next.additionalProperties)) {
    next.additionalProperties = fixJsonSchema(next.additionalProperties)
  }

  return next
}
