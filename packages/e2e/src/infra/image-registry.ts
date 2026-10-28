import type { Evidence } from "../harness/evidence"
import { networkInterfaces } from "node:os"
import { command } from "../harness/process"

/** Provisions an isolated HTTP OCI registry reachable from the host and disposable engines. */
export async function provisionImageRegistry(id: string, evidence: Evidence) {
  const name = `${id}-registry`
  const host = Object.values(networkInterfaces())
    .flat()
    .find(address => address?.family === "IPv4" && !address.internal)?.address
  if (!host) throw new Error("No container-reachable IPv4 address for the image registry")
  try {
    await command([
      "docker",
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `highstate.io/e2e=${id}`,
      "--publish",
      "0.0.0.0::5000",
      "registry:2.8.3",
    ])
    const binding = await command(["docker", "port", name, "5000/tcp"])
    const port = binding.split("\n")[0]!.split(":").at(-1)!
    const address = `${host}:${port}`
    const deadline = Date.now() + 30_000
    while (true) {
      try {
        if ((await fetch(`http://${address}/v2/`, { signal: AbortSignal.timeout(1000) })).ok) break
      } catch {}
      if (Date.now() > deadline) throw new Error("Disposable OCI registry did not become ready")
      await Bun.sleep(250)
    }
    await evidence.write("image-registry.json", { address, transport: "http", disposable: true })
    return {
      address,
      repository: `${address}/conformance`,
      async dispose() {
        try {
          await command(["docker", "logs", name], { evidence, name: "image-registry.log" })
        } finally {
          await command(["docker", "rm", "--force", "--volumes", name])
        }
      },
    }
  } catch (error) {
    await command(["docker", "rm", "--force", "--volumes", name]).catch(() => {})
    throw error
  }
}
