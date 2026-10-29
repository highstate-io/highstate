import type { Evidence } from "./evidence"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface BackendProcess {
  url: string
  token: string
  stop(force?: boolean): Promise<void>
}

/**
 * Starts the ordinary backend composition and public and TLS runtime listeners in another process.
 */
export async function startBackend(options: {
  root: string
  directory: string
  url: string
  runtimePort: number
  runnerImage: string
  evidence: Evidence
  logName?: string
}): Promise<BackendProcess> {
  const credentials = join(options.directory, "credential")

  const child = Bun.spawn(["bun", join(options.root, "packages/e2e/src/harness/backend-main.ts")], {
    cwd: options.directory,
    env: {
      PATH: process.env.PATH,
      HOME: options.directory,
      HIGHSTATE_CODEBASE_PATH: options.directory,
      HIGHSTATE_ENCRYPTION_ENABLED: "false",
      HIGHSTATE_E2E_API_URL: options.url,
      HIGHSTATE_E2E_WORKER_SOCKET: join(options.directory, "worker.sock"),
      HIGHSTATE_E2E_CREDENTIALS: credentials,
      HIGHSTATE_LOG_LEVEL: "debug",
      HIGHSTATE_RUNNER_BASE_IMAGE: options.runnerImage,
      HIGHSTATE_INITIAL_LIBRARY_PACKAGES: "[]",
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES: "",
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: options.directory,
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: "false",
      HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: "false",
      HIGHSTATE_RUNNER_BACKEND_LOCAL_CACHE_DIR: join(options.directory, "cache"),
      HIGHSTATE_RUNTIME_TLS_CERT_PATH: join(options.directory, "cert.pem"),
      HIGHSTATE_RUNTIME_TLS_KEY_PATH: join(options.directory, "key.pem"),
      HIGHSTATE_RUNTIME_HOST: "0.0.0.0",
      HIGHSTATE_RUNTIME_PORT: String(options.runtimePort),
    },
    stdout: "pipe",
    stderr: "pipe",
    ipc(message) {
      if (typeof message === "object" && message !== null && "ready" in message) {
        ready()
      }
    },
  })

  let ready!: () => void

  const started = new Promise<void>(resolve => {
    ready = resolve
  })

  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()

  const exited = child.exited.then(async code => {
    const output = `${await stdout}\n${await stderr}`
    await options.evidence.write(options.logName ?? "backend.log", output)
    return new Error(`Backend exited (${code}): ${output}`)
  })

  try {
    await Promise.race([
      started,
      exited.then(error => {
        throw error
      }),
      Bun.sleep(60_000).then(() => {
        throw new Error("Backend startup timed out")
      }),
    ])

    const token = await readFile(credentials, "utf8")
    options.evidence.redact(token)
    return {
      url: options.url,
      token,
      async stop(force = false) {
        child.kill(force ? "SIGKILL" : "SIGTERM")

        await Promise.race([
          child.exited,
          Bun.sleep(15_000).then(() => {
            child.kill("SIGKILL")
            return child.exited
          }),
        ])

        await exited
      },
    }
  } catch (error) {
    child.kill("SIGKILL")
    const exitError = await exited
    throw new Error(`Backend startup failed: ${exitError.message}`, { cause: error })
  }
}
