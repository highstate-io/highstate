import type { Logger } from "pino"

export function createProjectLogger(logger: Logger, projectId: string): Logger {
  return logger.child({ projectId }, { msgPrefix: `[project:${projectId}] ` })
}
