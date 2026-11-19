import assert from "node:assert/strict"
import { lstat, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { root, startDesigner } from "../harness/designer"
import { Evidence } from "../harness/evidence"

const evidence = new Evidence(
  join(root, ".artifacts/e2e", `isolation-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`),
)

const directory = await mkdtemp(join(tmpdir(), "highstate-socket-sentinel-"))
const sentinel = join(directory, "worker.sock")
const server = createServer(socket => socket.end())

await new Promise<void>((resolve, reject) => {
  server.once("error", reject)
  server.listen(sentinel, resolve)
})

const environments: Awaited<ReturnType<typeof startDesigner>>[] = []
const stopped = new Set<string>()

try {
  for (let index = 0; index < 2; index++) {
    // even an explicit caller override cannot point the harness at another backend's socket
    environments.push(
      await startDesigner({ env: { HIGHSTATE_DESIGNER_WORKER_SOCKET_PATH: sentinel } }),
    )
  }

  const [first, second] = environments
  assert.notEqual(first!.workerSocketPath, second!.workerSocketPath)
  assert.equal((await lstat(sentinel)).isSocket(), true)

  for (const environment of environments) {
    assert.equal((await lstat(environment.workerSocketPath)).isSocket(), true)
    const response = await fetch("http://localhost/", { unix: environment.workerSocketPath })
    assert.equal(response.status, 404)
  }

  await first!.stop()
  stopped.add(first!.directory)
  await assert.rejects(lstat(first!.workerSocketPath), { code: "ENOENT" })
  assert.equal((await lstat(second!.workerSocketPath)).isSocket(), true)
  assert.equal((await fetch("http://localhost/", { unix: second!.workerSocketPath })).status, 404)
  assert.equal((await lstat(sentinel)).isSocket(), true)

  console.log(
    "PASS concurrent Designer Unix sockets stay isolated and cleanup preserves other listeners",
  )

  await evidence.write("isolation.json", {
    status: "passed",
    concurrentDesigners: 2,
    preservesOtherListener: true,
  })
} catch (error) {
  await evidence.write("isolation.json", { status: "failed", error: String(error) })
  throw error
} finally {
  for (const environment of environments) {
    if (!stopped.has(environment.directory)) {
      await environment.stop()
    }
  }

  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
}
