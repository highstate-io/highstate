import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test, vi } from "vitest"
import { inspectDesigner } from "./inspection"

test("keeps the existing server alive for an external browser until inspection ends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "highstate-inspection-test-"))
  const stop = vi.fn(async () => {})
  const controller = new AbortController()
  let finished = false

  const inspecting = inspectDesigner(
    {
      url: "http://127.0.0.1:12345",
      workerSocketPath: join(directory, "worker.sock"),
      directory,
      mode: "development",
      logs: () => "",
      stop,
    },
    [],
    controller.signal,
  ).then(() => {
    finished = true
  })

  try {
    await vi.waitFor(async () => {
      const manifest = JSON.parse(await readFile(join(directory, "inspection.json"), "utf8"))
      expect(manifest.url).toBe("http://127.0.0.1:12345")
    })

    expect(finished).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    controller.abort()
    await inspecting
    expect(finished).toBe(true)
    expect(stop).not.toHaveBeenCalled()
  } finally {
    controller.abort()
    await inspecting
    await rm(directory, { recursive: true, force: true })
  }
})
