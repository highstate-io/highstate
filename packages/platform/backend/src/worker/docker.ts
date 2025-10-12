import type { WorkerRunOptions } from "@highstate/contract"
import type { Logger } from "pino"
import type { WorkerBackend, WorkerRunOptions as WorkerRunBackendOptions } from "./abstractions"
import { Readable } from "node:stream"
import spawn from "nano-spawn"
import { z } from "zod"

export const dockerWorkerBackendConfig = z.object({
  HIGHSTATE_WORKER_BACKEND_DOCKER_BINARY: z.string().default("docker"),
  HIGHSTATE_WORKER_BACKEND_DOCKER_USE_SUDO: z.coerce.boolean().default(false),
  HIGHSTATE_WORKER_BACKEND_DOCKER_HOST: z.string().optional(),
})

export class DockerWorkerBackend implements WorkerBackend {
  constructor(
    private readonly binary: string,
    private readonly useSudo: boolean,
    private readonly host: string | undefined,
    private readonly logger: Logger,
  ) {}

  async run({
    projectId,
    workerVersionId,
    image,
    apiKey,
    apiPath,
    stdout,
    signal,
  }: WorkerRunBackendOptions): Promise<void> {
    const args = ["run", "-i", "-v", `${apiPath}:/var/run/highstate.sock`, image]

    const runOptions: WorkerRunOptions = {
      projectId,
      workerVersionId,
      apiKey,
      apiUrl: "unix:///var/run/highstate.sock",
    }

    const initDataStream = Readable.from(`${JSON.stringify(runOptions)}\n`)

    if (this.useSudo) {
      args.unshift(this.binary)
    }

    const process = spawn(this.useSudo ? "sudo" : this.binary, args, {
      env: {
        DOCKER_HOST: this.host,
      },
      signal,
    })

    const childProcess = await process.nodeChildProcess

    initDataStream.pipe(childProcess.stdin!)

    childProcess.stdout?.pipe(stdout)
    childProcess.stderr?.pipe(stdout)

    if (!childProcess.pid) {
      throw new Error(`Failed to start Docker container without clear response from child process.`)
    }

    this.logger.info({ processId: childProcess.pid }, "process started")

    await process
  }

  static create(config: z.infer<typeof dockerWorkerBackendConfig>, logger: Logger): WorkerBackend {
    return new DockerWorkerBackend(
      config.HIGHSTATE_WORKER_BACKEND_DOCKER_BINARY,
      config.HIGHSTATE_WORKER_BACKEND_DOCKER_USE_SUDO,
      config.HIGHSTATE_WORKER_BACKEND_DOCKER_HOST,
      logger.child({ backend: "WorkerBackend", service: "DockerWorkerBackend" }),
    )
  }
}
