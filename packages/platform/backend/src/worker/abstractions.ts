export type WorkerRunOptions = {
  /**
   * The ID of the project to run the worker for.
   */
  projectId: string

  /**
   * The ID of the worker version to run.
   */
  workerVersionId: string

  /**
   * The image of the worker to run.
   */
  image: string

  /**
   * The token of the API key to pass to the worker.
   */
  apiKey: string

  /**
   * The path of the API socket to pass to the worker.
   */
  apiPath: string

  /**
   * The output stream.
   */
  stdout: NodeJS.WritableStream

  /**
   * The signal to abort the worker.
   */
  signal?: AbortSignal
}

export interface WorkerBackend {
  /**
   * Runs a worker with the given options.
   *
   * @param options The options.
   */
  run(options: WorkerRunOptions): Promise<void>
}
