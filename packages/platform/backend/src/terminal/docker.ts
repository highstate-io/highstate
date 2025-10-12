import type { Logger } from "pino"
import type { TerminalBackend, TerminalRunOptions } from "./abstractions"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { Readable } from "node:stream"
import spawn from "nano-spawn"
import { z } from "zod"
import { runScript } from "./run.sh"

export const dockerTerminalBackendConfig = z.object({
  HIGHSTATE_TERMINAL_BACKEND_DOCKER_BINARY: z.string().default("docker"),
  HIGHSTATE_TERMINAL_BACKEND_DOCKER_USE_SUDO: z.coerce.boolean().default(false),
  HIGHSTATE_TERMINAL_BACKEND_DOCKER_HOST: z.string().optional(),
})

export class DockerTerminalBackend implements TerminalBackend {
  constructor(
    private readonly binary: string,
    private readonly useSudo: boolean,
    private readonly host: string | undefined,
    private readonly logger: Logger,
  ) {}

  async run({ spec, stdin, stdout, screenSize, signal }: TerminalRunOptions): Promise<void> {
    const hsTempDir = resolve(tmpdir(), "highstate")
    await mkdir(hsTempDir, { recursive: true })

    const runScriptPath = resolve(hsTempDir, "run.sh")
    await writeFile(runScriptPath, runScript, { mode: 0o755 })

    const args = [
      "run",
      "-i",
      "-v",
      `${runScriptPath}:/run.sh:ro`,
      spec.image,
      "/bin/bash",
      "/run.sh",
    ]

    const initData = {
      command: spec.command,
      cwd: spec.cwd,
      env: {
        ...spec.env,
        TERM: "xterm-256color",
      },
      files: spec.files ?? {},
      screenSize,
    }

    const initDataStream = Readable.from(`${JSON.stringify(initData)}\n`)

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

    initDataStream.pipe(childProcess.stdin!, { end: false })
    initDataStream.on("end", () => stdin.pipe(childProcess.stdin!))

    childProcess.stdout?.pipe(stdout)
    childProcess.stderr?.pipe(stdout)

    if (!childProcess.pid) {
      throw new Error(`Failed to start Docker container without clear response from child process.`)
    }

    this.logger.info({ processId: childProcess.pid }, "process started")

    await process
  }

  static create(
    config: z.infer<typeof dockerTerminalBackendConfig>,
    logger: Logger,
  ): DockerTerminalBackend {
    return new DockerTerminalBackend(
      config.HIGHSTATE_TERMINAL_BACKEND_DOCKER_BINARY,
      config.HIGHSTATE_TERMINAL_BACKEND_DOCKER_USE_SUDO,
      config.HIGHSTATE_TERMINAL_BACKEND_DOCKER_HOST,
      logger.child({ backend: "TerminalBackend", service: "DockerTerminalBackend" }),
    )
  }
}
