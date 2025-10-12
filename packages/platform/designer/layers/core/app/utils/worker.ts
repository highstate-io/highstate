import type { EventHookOn } from "@vueuse/core"

export type WebWorker<TInput, TOutput> = {
  onMessage: EventHookOn<[TOutput]>
  onError: EventHookOn<[Error]>
  postMessage: (message: TInput) => void
}

export function useHSWebWorker<TInput, TOutput>(
  workerConstructor: new (options?: { name?: string }) => SharedWorker,
  options?: WorkerOptions,
): WebWorker<TInput, TOutput> {
  let currentWorker: SharedWorker | null = null

  const { on: onMessage, trigger: triggerMessage } = createEventHook<[TOutput]>()
  const { on: onError, trigger: triggerError } = createEventHook<[Error]>()

  const createWorker = () => {
    currentWorker = new workerConstructor(options)

    globalLogger.info(`creating worker "%s"`, options?.name ?? "unnamed")

    currentWorker.onerror = event => {
      globalLogger.error(
        {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
        "worker error, restarting worker",
      )

      triggerError(new Error(`Worker error: ${event.message}`))

      currentWorker = null
      createWorker()
    }

    currentWorker.port.onmessage = (event: MessageEvent<TOutput>) => {
      triggerMessage(event.data)
    }

    currentWorker.port.onmessageerror = (event: MessageEvent) => {
      globalLogger.error(
        {
          message: event.data,
        },
        "worker message error",
      )

      triggerError(new Error(`Worker message error: ${event.data}`))
    }
  }

  const postMessage = (message: TInput) => {
    currentWorker!.port.postMessage(message)
  }

  createWorker()

  return { onMessage, onError, postMessage }
}
