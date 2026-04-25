import { PassThrough } from "node:stream"
import { consola, LogLevels } from "consola"
import pino, { levels } from "pino"

export const logger = pino(
  {
    name: "highstate-cli",
    level: process.env.LOG_LEVEL ?? "info",
    serializers: {
      error: value => serializeError(value),
    },
  },
  createConsolaStream(),
)

consola.level = LogLevels[(process.env.LOG_LEVEL as keyof typeof LogLevels) ?? "info"]

function createConsolaStream() {
  const stream = new PassThrough()

  stream.on("data", data => {
    const { level, msg, error } = JSON.parse(String(data)) as {
      msg: string
      level: number
      error?: unknown
    }

    const levelLabel = levels.labels[level]

    switch (levelLabel) {
      case "info":
        consola.info(msg)
        break
      case "warn":
        consola.warn(msg)
        break
      case "error":
        if (error) {
          consola.error(msg, error)
        } else {
          consola.error(msg)
        }
        break
      case "debug":
        consola.debug(msg)
        break
      case "fatal":
        consola.fatal(msg)
        break
      case "trace":
        consola.trace(msg)
        break
    }
  })

  return stream
}

function serializeError(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error) {
    const base: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }

    const cause = (value as Error & { cause?: unknown }).cause
    if (cause !== undefined) {
      base.cause = serializeError(cause, seen)
    }

    const extraEntries = Object.entries(value)
    if (extraEntries.length > 0) {
      base.details = Object.fromEntries(
        extraEntries.map(([key, entryValue]) => [key, serializeError(entryValue, seen)]),
      )
    }

    return base
  }

  if (Array.isArray(value)) {
    return value.map(entry => serializeError(entry, seen))
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]"
    }

    seen.add(value)

    const entries = Object.entries(value)
    if (entries.length === 0) {
      return {
        type: value.constructor?.name ?? "Object",
        message: String(value),
      }
    }

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, serializeError(entryValue, seen)]),
    )
  }

  return {
    type: typeof value,
    message: String(value),
  }
}
