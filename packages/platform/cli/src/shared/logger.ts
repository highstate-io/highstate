import { PassThrough } from "node:stream"
import { consola, LogLevels } from "consola"
import pino, { levels } from "pino"

export const logger = pino(
  {
    name: "highstate-cli",
    level: process.env.LOG_LEVEL ?? "info",
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
