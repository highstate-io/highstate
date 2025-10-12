import pino from "pino"

export const globalLogger = pino({
  level: import.meta.dev ? "debug" : "info",
})
