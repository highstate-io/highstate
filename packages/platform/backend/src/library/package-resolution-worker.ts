import { realpath } from "node:fs/promises"
import { dirname } from "node:path"
import { parentPort, workerData } from "node:worker_threads"
import pino, { type Level } from "pino"
import { findPackageJSONCompat } from "./find-package-json"

export type PackageResolutionWorkerData = {
  importPath: string
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

const { importPath: rootDir, packageNames, logLevel } = workerData as PackageResolutionWorkerData

const logger = pino({ name: "source-resolution-worker", level: logLevel ?? "silent" })

const results: PackageResult[] = []

for (const packageName of packageNames) {
  try {
    const path = await findPackageJSONCompat(packageName, rootDir)
    if (!path) {
      results.push({
        type: "not-found",
        packageName,
      })
      continue
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
