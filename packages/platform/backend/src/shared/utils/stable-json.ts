export function stableJsonStringify(value: unknown): string {
  if (value === null) {
    return "null"
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error("Snapshot content contains a non-finite number")
      }

      return JSON.stringify(value)
    }
    case "boolean":
      return value ? "true" : "false"
    case "object": {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      const parts: string[] = []

      for (const key of keys) {
        const item = record[key]
        if (item === undefined) {
          throw new Error("Snapshot content contains undefined")
        }

        parts.push(`${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      }

      return `{${parts.join(",")}}`
    }
    default:
      throw new Error(`Snapshot content contains non-JSON value of type "${typeof value}"`)
  }
}
