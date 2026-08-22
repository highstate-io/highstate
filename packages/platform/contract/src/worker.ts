import { z } from "zod"

export const unitWorkerSchema = z.object({
  name: z.string(),
  image: z.string(),
  params: z.record(z.string(), z.unknown()),
})

export type UnitWorker = z.infer<typeof unitWorkerSchema>

export const workerRunOptionsSchema = z.object({
  /**
   * The ID of the project for which the worker is running.
   */
  projectId: z.cuid2(),

  /**
   * The ID of the worker version.
   */
  workerVersionId: z.cuid2(),

  /**
   * The ID of the concrete worker instance.
   */
  workerInstanceId: z.cuid2(),

  /**
   * The URL of the backend API to connect to.
   */
  apiUrl: z.url(),

  /**
   * The host and port of the worker data endpoint reachable by the frontend gateway.
   */
  dataEndpoint: z.string().min(1),

  /**
   * The API key used to authenticate the worker with the backend.
   */
  apiKey: z.string(),
})

export type WorkerRunOptions = z.infer<typeof workerRunOptionsSchema>
