import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export const root = resolve(import.meta.dir, "../../../..")

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
 * Starts the built Designer against disposable storage, never an existing server or database.
 */
export async function startDesigner(
  options: { env?: Record<string, string>; directory?: string } = {},
) {
  const directory = options.directory ?? (await mkdtemp(join(tmpdir(), "highstate-browser-")))
  let child: ReturnType<typeof Bun.spawn> | undefined
  let output = ""

  try {
    await mkdir(join(directory, "home"), { recursive: true })
    await mkdir(join(directory, ".highstate"), { recursive: true })

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "highstate-browser-isolated", private: true, workspaces: [] }),
    )

    await writeFile(
      join(directory, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "highstate-browser-isolated" } },
        packages: {},
      }),
    )

    const port = await freePort()
    let eventsPort = await freePort()

    while (eventsPort === port) {
      eventsPort = await freePort()
    }

    const url = `http://127.0.0.1:${port}`

    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(HIGHSTATE_|NUXT_|NITRO_|DATABASE_URL$|DOTENV_|BUN_ENV$|NODE_ENV$)/.test(key),
      ),
    )

    child = Bun.spawn(
      [process.execPath, join(root, "packages/platform/designer/.output/server/index.mjs")],
      {
        cwd: directory,
        env: {
          ...env,
          NODE_ENV: "production",
          HOME: join(directory, "home"),
          XDG_CONFIG_HOME: join(directory, "home/.config"),
          XDG_CACHE_HOME: join(directory, "home/.cache"),
          HIGHSTATE_CODEBASE_PATH: directory,
          HIGHSTATE_BACKEND_DATABASE_LOCAL_PATH: join(directory, ".highstate"),
          HIGHSTATE_ENCRYPTION_ENABLED: "false",
          HIGHSTATE_INITIAL_LIBRARY_PACKAGES: "[]",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: directory,
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_IMPORT_PATH: join(directory, "package.json"),
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES: "[]",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: "false",
          HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: "false",
          HIGHSTATE_PUBLIC_API_URL: url,
          NITRO_HOST: "127.0.0.1",
          NITRO_PORT: String(port),
          NUXT_PUBLIC_EVENTS_PORT: String(eventsPort),
          ...options.env,
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
        throw new Error(`Production Designer exited (${child.exitCode})\n${output}`)
      }

      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
        if (response.ok) {
          break
        }
      } catch {}

      if (Date.now() > deadline) {
        throw new Error(`Production Designer readiness timed out\n${output}`)
      }

      await Bun.sleep(200)
    }

    return {
      url,
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

        if (!options.directory) {
          await rm(directory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    child?.kill("SIGKILL")
    await child?.exited

    if (!options.directory) {
      await rm(directory, { recursive: true, force: true })
    }

    throw error
  }
}
