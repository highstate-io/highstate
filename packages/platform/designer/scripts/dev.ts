import { createServer } from "node:net"

const tryPort = async (port: number): Promise<boolean> => {
  return await new Promise(resolve => {
    const server = createServer()

    server.once("error", () => resolve(false))
    server.listen(port, "127.0.0.1", () => {
      server.close(error => resolve(!error))
    })
  })
}

const getRandomPort = async (): Promise<number> => {
  return await new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)

    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to allocate a Designer development port"))
        return
      }

      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

const getAvailablePort = async (preferredPort: number): Promise<number> => {
  return (await tryPort(preferredPort)) ? preferredPort : await getRandomPort()
}

const parsePort = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }

  return port
}

const configuredFrontendPort = parsePort("NITRO_PORT", process.env.NITRO_PORT)
const configuredEventsPort = parsePort(
  "NUXT_PUBLIC_EVENTS_PORT",
  process.env.NUXT_PUBLIC_EVENTS_PORT,
)

if (configuredFrontendPort !== undefined && !(await tryPort(configuredFrontendPort))) {
  throw new Error(`NITRO_PORT ${configuredFrontendPort} is already in use`)
}

if (configuredEventsPort !== undefined && !(await tryPort(configuredEventsPort))) {
  throw new Error(`NUXT_PUBLIC_EVENTS_PORT ${configuredEventsPort} is already in use`)
}

const frontendPort = configuredFrontendPort ?? (await getAvailablePort(3000))
let eventsPort = configuredEventsPort ?? (await getAvailablePort(3002))

while (configuredEventsPort === undefined && eventsPort === frontendPort) {
  eventsPort = await getRandomPort()
}

if (frontendPort === eventsPort) {
  throw new Error("NITRO_PORT and NUXT_PUBLIC_EVENTS_PORT must be different")
}

console.log(`Designer frontend: http://highstate.localhost:${frontendPort}/`)
console.log(`Designer events: ws://highstate.localhost:${eventsPort}/`)

const server = Bun.spawn(["bun", "run", "dev:server"], {
  cwd: import.meta.dirname + "/..",
  env: {
    ...process.env,
    NITRO_PORT: frontendPort.toString(),
    NUXT_PUBLIC_EVENTS_PORT: eventsPort.toString(),
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exitCode = await server.exited
