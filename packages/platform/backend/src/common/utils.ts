import { z } from "zod"

export async function runWithRetryOnError<T>(
  runner: () => T | Promise<T>,
  tryHandleError: (error: unknown) => boolean | Promise<boolean>,
  maxRetries: number = 1,
): Promise<T> {
  let lastError: unknown

  for (let i = 0; i < maxRetries + 1; i++) {
    try {
      return await runner()
    } catch (e) {
      lastError = e

      if (await tryHandleError(e)) {
        continue
      }

      throw e
    }
  }

  throw lastError
}

export class AbortError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AbortError"
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

const abortMessagePatterns = [
  "Operation aborted",
  "This operation was aborted",
  "Command was killed with SIGINT",
]

export function isAbortErrorLike(error: unknown): boolean {
  if (error instanceof AggregateError) {
    const errors = Array.from(error.errors ?? [])
    if (errors.length === 0) {
      return false
    }

    return errors.every(isAbortErrorLike)
  }

  if (isAbortError(error)) {
    return true
  }

  if (error instanceof Error) {
    return abortMessagePatterns.some(pattern => error.message.includes(pattern))
  }

  if (typeof error === "string") {
    return abortMessagePatterns.some(pattern => error.includes(pattern))
  }

  return false
}

export function tryWrapAbortErrorLike(error: unknown): unknown {
  if (isAbortErrorLike(error)) {
    return new AbortError("Operation aborted", { cause: error })
  }

  return error
}

export const stringArrayType = z.string().transform(args => args.split(",").map(arg => arg.trim()))

export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  return JSON.stringify(error)
}

export function valueToString(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  return JSON.stringify(value)
}

export function stringToValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }

    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}
