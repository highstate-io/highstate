import type { WorkerData } from "./protocol"
import { parentPort, workerData } from "node:worker_threads"
import { pino } from "pino"
import { errorToString } from "../../common"
import { evaluateProject } from "./evaluator"
import { loadComponents } from "./loader.lite"

const data = workerData as WorkerData

const logger = pino({ name: "library-worker" })

try {
  const library = await loadComponents(logger, data.libraryModulePaths)
  const result = evaluateProject(logger, library, data.allInstances, data.resolvedInputs)

  parentPort?.postMessage(result)
} catch (error) {
  logger.error({ error }, "failed to evaluate project")

  parentPort?.postMessage({
    success: false,
    error: errorToString(error),
  })
}
