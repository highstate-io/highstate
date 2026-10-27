import type {
  ContainerRuntimeAdapter,
  RuntimeCoordinator,
  WorkloadIntent,
} from "../container-runtime"
import { randomUUID } from "node:crypto"
import { PassThrough } from "node:stream"
import { describe, expect, test, vi } from "vitest"
import { DockerRuntimeAdapter } from "../container-runtime"
import { RuntimeTerminalBackend } from "./runtime"

function coordinatorFor(adapter: ContainerRuntimeAdapter) {
  const workload = {
    id: randomUUID(),
    runtimeId: "project-selected-runtime",
    projectId: "project",
    leaseGeneration: 1,
  }
  const owner = {
    backendId: "terminal-test",
    projectId: "project",
    runtimeId: workload.runtimeId,
    workloadId: workload.id,
    kind: "terminal" as const,
    generation: 1,
  }
  const coordinator = {
    leaseDurationMs: 30000,
    createWorkload: vi.fn(async () => workload),
    place: vi.fn(
      async (_id: string, intent: Omit<WorkloadIntent, "owner">, signal?: AbortSignal) => ({
        ...workload,
        nativeResourceId: (await adapter.place({ ...intent, owner }, signal)).id,
      }),
    ),
    renewBackendLease: vi.fn(),
    requestCleanup: vi.fn(async () => await adapter.cleanup(owner)),
  }
  return {
    coordinator,
    backend: new RuntimeTerminalBackend(coordinator as unknown as RuntimeCoordinator, {
      get: async id => {
        expect(id).toBe(workload.runtimeId)
        return adapter
      },
    }),
  }
}

describe("runtime terminals", () => {
  test("rejects unavailable attachment and cleans the persisted domain workload", async () => {
    const cleanup = vi.fn()
    const { coordinator, backend } = coordinatorFor({
      capabilities: { attach: false },
      cleanup,
    } as unknown as ContainerRuntimeAdapter)
    await expect(
      backend.run({
        projectId: "project",
        sessionId: "session",
        spec: { image: "arbitrary", command: ["tool", "argument with spaces"] },
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        screenSize: { cols: 80, rows: 24 },
      }),
    ).rejects.toThrow("attachment")
    expect(coordinator.createWorkload).toHaveBeenCalledWith({
      projectId: "project",
      kind: "terminal",
      ownerId: "session",
    })
    expect(cleanup).toHaveBeenCalledOnce()
    expect(coordinator.place).not.toHaveBeenCalled()
  })

  test.runIf(process.env.HIGHSTATE_DOCKER_SMOKE === "true")(
    "attaches, resizes, logs and cleans an arbitrary image with no Highstate runtime",
    async () => {
      const adapter = new DockerRuntimeAdapter({
        endpoint: "unix:///var/run/docker.sock",
        local: true,
      })
      const { backend, coordinator } = coordinatorFor(adapter)
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      let output = ""
      let sent = false
      stdout.on("data", data => {
        output += String(data)
        if (!sent && output.includes("READY")) {
          sent = true
          setTimeout(() => {
            void backend
              .resize("session", { cols: 93, rows: 37 })
              .then(() => stdin.write("hello world\n"))
          }, 200)
        }
      })
      await backend.run({
        projectId: "project",
        sessionId: "session",
        spec: {
          image: "oven/bun:1.3.13-debian",
          cwd: "/tmp",
          env: { VALUE: "spaces preserved" },
          command: [
            "/bin/sh",
            "-c",
            "printf 'READY\\n'; read -r value; stty size; printf '%s:%s:' \"$value\" \"$VALUE\"; cat /tmp/test-content",
          ],
          files: {
            "/tmp/test-content": {
              meta: { name: "test-content" },
              content: { type: "embedded", value: "file without newline" },
            },
          },
        },
        stdin,
        stdout,
        screenSize: { cols: 80, rows: 24 },
        signal: AbortSignal.timeout(15000),
      })
      expect(output).toContain("37 93")
      expect(output).toContain("hello world:spaces preserved:file without newline")
      expect(coordinator.requestCleanup).toHaveBeenCalledOnce()
      const intent = coordinator.place.mock.calls[0]![1]
      expect(intent.localBinds).toBeUndefined()
      expect(intent.command?.[0]).toBe("/bin/sh")
    },
    20000,
  )
})
