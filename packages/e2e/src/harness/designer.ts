import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { encode } from "@msgpack/msgpack"
import { preparePulumiCli } from "./toolchain"

export const root = resolve(import.meta.dir, "../../../..")

export type DesignerLaunchContext = {
  url: string
  eventsPort: number
  workerSocketPath: string
  directory: string
}

async function freePort(): Promise<number> {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("No allocated port")
  }

  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  )

  return address.port
}

/**
 * Starts production or development Designer against disposable storage, never an existing server or database.
 */
export async function startDesigner(
  options: {
    env?:
      | Record<string, string>
      | ((
          context: DesignerLaunchContext,
        ) => Record<string, string> | Promise<Record<string, string>>)
    directory?: string
    mode?: "production" | "development"
  } = {},
) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "highstate-e2e-")))
  // runtime sockets must not be scanned by the codebase's library watcher
  const workerSocketPath = join(directory, ".highstate", "worker.sock")
  let child: ReturnType<typeof Bun.spawn> | undefined
  let output = ""

  try {
    await mkdir(join(directory, "home"), { recursive: true })
    await mkdir(join(directory, ".highstate"), { recursive: true })
    const pulumiBin = await preparePulumiCli(directory)
    const library = join(directory, "node_modules/@highstate/e2e-library")
    await mkdir(join(library, "dist"), { recursive: true })

    await writeFile(
      join(library, "package.json"),
      JSON.stringify({
        name: "@highstate/e2e-library",
        private: true,
      }),
    )

    await writeFile(
      join(library, "dist/highstate.library.msgpack"),
      encode({ components: {}, entities: {} }),
    )

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "highstate-e2e-isolated", private: true, workspaces: [] }),
    )

    await writeFile(
      join(directory, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "highstate-e2e-isolated" } },
        packages: {},
      }),
    )

    const port = await freePort()
    let eventsPort = await freePort()

    while (eventsPort === port) {
      eventsPort = await freePort()
    }

    const url = `http://127.0.0.1:${port}`

    const extraEnv =
      typeof options.env === "function"
        ? await options.env({ url, eventsPort, workerSocketPath, directory })
        : options.env

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(HIGHSTATE_|PULUMI_|NUXT_|NITRO_|DATABASE_URL$|DOTENV_|BUN_ENV$|NODE_ENV$)/.test(key),
      ),
    )

    child = Bun.spawn(
      options.mode === "development"
        ? [process.execPath, "run", "--bun", "--filter", "@highstate/designer", "dev"]
        : [process.execPath, join(root, "packages/platform/designer/.output/server/index.mjs")],
      {
        cwd: options.mode === "development" ? root : directory,
        env: {
          ...env,
          NODE_ENV: options.mode === "development" ? "development" : "production",
          HIGHSTATE_DESIGNER_NO_REDIRECT: "1",
          HOME: join(directory, "home"),
          PULUMI_HOME: join(directory, "home/.pulumi"),
          PATH: `${pulumiBin}:${process.env.PATH ?? ""}`,
          XDG_CONFIG_HOME: join(directory, "home/.config"),
          XDG_CACHE_HOME: join(directory, "home/.cache"),
          HIGHSTATE_CODEBASE_PATH: directory,
          HIGHSTATE_BACKEND_DATABASE_LOCAL_PATH: join(directory, ".highstate"),
          HIGHSTATE_ENCRYPTION_ENABLED: "false",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: directory,
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_IMPORT_PATH: join(directory, "package.json"),
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES: "@highstate/e2e-library",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: "false",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: "false",
          NITRO_HOST: "127.0.0.1",
          NITRO_PORT: String(port),
          NUXT_PUBLIC_EVENTS_PORT: String(eventsPort),
          ...extraEnv,
          HIGHSTATE_DESIGNER_WORKER_SOCKET_PATH: workerSocketPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    const consume = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder()

      for await (const chunk of stream) {
        output = (output + decoder.decode(chunk)).slice(-100_000)
      }
    }

    const logs = Promise.all([
      consume(child.stdout as ReadableStream<Uint8Array>),
      consume(child.stderr as ReadableStream<Uint8Array>),
    ])

    const deadline = Date.now() + 60_000

    while (true) {
      if (child.exitCode !== null) {
        throw new Error(`Designer exited (${child.exitCode})\n${output}`)
      }

      try {
        const response = await fetch(
          `${url}${extraEnv?.HIGHSTATE_AUTH_MODE === "hosted" ? "/api/auth/config" : "/api/state.getBackendState"}`,
          {
            signal: AbortSignal.timeout(1000),
          },
        )

        if (
          response.ok &&
          (await lstat(workerSocketPath).then(
            stat => stat.isSocket(),
            () => false,
          ))
        ) {
          break
        }
      } catch {}

      if (Date.now() > deadline) {
        throw new Error(`Designer readiness timed out\n${output}`)
      }

      await Bun.sleep(200)
    }

    return {
      url,
      directory,
      workerSocketPath,
      mode: options.mode ?? "production",
      logs: () => output,
      async stop() {
        child?.kill("SIGTERM")

        const exited = await Promise.race([
          child?.exited.then(() => true),
          Bun.sleep(5000).then(() => false),
        ])

        if (!exited) {
          child?.kill("SIGKILL")
        }

        await child?.exited
        await logs
        await rm(workerSocketPath, { force: true })

        if (!options.directory) {
          await rm(directory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    child?.kill("SIGKILL")
    await child?.exited
    await rm(workerSocketPath, { force: true })

    if (!options.directory) {
      await rm(directory, { recursive: true, force: true })
    }

    throw error
  }
}
