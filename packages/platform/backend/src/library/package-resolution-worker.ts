import { realpath } from "node:fs/promises"
import { findPackageJSON } from "node:module"
import { dirname } from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import pino, { type Level } from "pino"

export type PackageResolutionWorkerData = {
  packageNames: string[]
  logLevel?: Level
}

export type PackageResult = { packageName: string } & (
  | {
      type: "success"
      packageRootPath: string
    }
  | {
      type: "not-found"
    }
  | {
      type: "error"
      error: string
    }
)

export type PackageResolutionResponse = {
  type: "result"
  results: PackageResult[]
}

const { packageNames, logLevel } = workerData as PackageResolutionWorkerData

const logger = pino({ name: "source-resolution-worker", level: logLevel ?? "silent" })

const results: PackageResult[] = []

for (const packageName of packageNames) {
  try {
    const path = findPackageJSON(packageName, import.meta.url)
    if (!path) {
      throw new Error(`Package "${packageName}" not found`)
    }

    results.push({
      type: "success",
      packageName,
      packageRootPath: await realpath(dirname(path)),
    })
  } catch (error) {
    logger.error({ error }, `failed to resolve package "%s"`, packageName)

    if (error instanceof Error && error.message.includes(`Cannot find package '${packageName}'`)) {
      results.push({
        type: "not-found",
        packageName,
      })
    } else {
      results.push({
        type: "error",
        packageName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

parentPort?.postMessage({
  type: "result",
  results,
})
