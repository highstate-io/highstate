import { randomUUID } from "node:crypto"
import { command } from "./process"

/**
 * Starts a disposable PostgreSQL container for hosted-authentication fixtures.
 */
export async function startPostgres() {
  const name = `highstate-e2e-${randomUUID()}`
  const password = randomUUID()
  let started = false

  try {
    await command(
      [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "-e",
        "POSTGRES_USER=highstate",
        "-e",
        "POSTGRES_DB=highstate",
        "-e",
        "POSTGRES_PASSWORD",
        "-p",
        "127.0.0.1::5432",
        "postgres:17-alpine",
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password }, timeoutMs: 180_000 },
    )

    started = true

    const containers = JSON.parse(await command(["docker", "inspect", name])) as {
      NetworkSettings: { Ports: Record<string, { HostPort: string }[]> }
    }[]

    const port = containers[0]!.NetworkSettings.Ports["5432/tcp"]![0]!.HostPort
    const deadline = Date.now() + 30_000

    while (true) {
      const ready = Bun.spawn(["docker", "exec", name, "pg_isready", "-U", "highstate"], {
        stdout: "ignore",
        stderr: "ignore",
      })

      if ((await ready.exited) === 0) {
        break
      }

      if (Date.now() >= deadline) {
        throw new Error("PostgreSQL fixture readiness timed out")
      }

      await Bun.sleep(200)
    }

    return {
      url: `postgresql://highstate:${password}@127.0.0.1:${port}/highstate`,
      async stop() {
        await command(["docker", "rm", "--force", name])
      },
    }
  } catch (error) {
    if (started) {
      await command(["docker", "rm", "--force", name])
    }

    throw error
  }
}
