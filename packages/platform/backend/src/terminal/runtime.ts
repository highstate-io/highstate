import type { File, TerminalSpec } from "@highstate/contract"
import type {
  RuntimeAdapterProvider,
  RuntimeCoordinator,
  RuntimeFile,
  RuntimeSession,
} from "../container-runtime"
import type { ScreenSize, TerminalBackend, TerminalRunOptions } from "./abstractions"
import { once } from "node:events"
import { delay } from "../container-runtime"

export type RuntimeTerminalOptions = {
  /** Resolves artifact content using the project's artifact authorization context. */
  readArtifact?: (projectId: string, file: File) => Promise<Uint8Array>
}

export class RuntimeTerminalBackend implements TerminalBackend {
  private readonly sessions = new Map<string, RuntimeSession>()

  constructor(
    private readonly coordinator: RuntimeCoordinator,
    private readonly adapters: RuntimeAdapterProvider,
    private readonly options: RuntimeTerminalOptions = {},
  ) {}

  async resize(sessionId: string, { cols, rows }: ScreenSize): Promise<void> {
    if (![cols, rows].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65535))
      throw new Error("Invalid terminal screen size")
    await this.sessions.get(sessionId)?.resize(cols, rows)
  }

  private async files(projectId: string, spec: TerminalSpec): Promise<RuntimeFile[]> {
    return await Promise.all(
      Object.entries(spec.files ?? {}).map(async ([path, file]) => {
        const { content, meta } = file
        if (content.type === "artifact") {
          if (!this.options.readArtifact)
            throw new Error("Terminal artifact resolver is not configured")
          return { path, data: await this.options.readArtifact(projectId, file), mode: meta.mode }
        }
        const value = content.type === "embedded-secret" ? content.value.value : content.value
        return {
          path,
          data: Buffer.from(value, content.isBinary ? "base64" : "utf8"),
          mode: meta.mode ?? (content.type === "embedded-secret" ? 0o600 : undefined),
        }
      }),
    )
  }

  async run({
    projectId,
    sessionId,
    spec,
    stdin,
    stdout,
    screenSize,
    signal,
  }: TerminalRunOptions): Promise<void> {
    signal?.throwIfAborted()
    const workload = await this.coordinator.createWorkload({
      projectId,
      kind: "terminal",
      ownerId: sessionId,
    })
    let renewal: ReturnType<typeof setInterval> | undefined
    let session: RuntimeSession | undefined
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    try {
      const adapter = await this.adapters.get(workload.runtimeId)
      if (!adapter.capabilities.attach)
        throw new Error("Selected runtime does not support terminal attachment")
      const placed = await this.coordinator.place(
        workload.id,
        {
          image: spec.image,
          command: spec.command,
          env: {
            ...spec.env,
            TERM: "xterm-256color",
            COLUMNS: String(screenSize.cols),
            LINES: String(screenSize.rows),
          },
          workingDir: spec.cwd,
          files: await this.files(projectId, spec),
          tty: true,
          mode: "pod",
        },
        combined,
      )
      renewal = setInterval(
        () => {
          void this.coordinator
            .renewBackendLease(workload.id, workload.leaseGeneration)
            .catch(error => controller.abort(error))
        },
        Math.max(100, Math.floor(this.coordinator.leaseDurationMs / 3)),
      )
      renewal.unref()
      let state = await adapter.inspect(placed.nativeResourceId!, combined)
      while (state.state === "pending") {
        await delay(100, combined)
        state = await adapter.inspect(placed.nativeResourceId!, combined)
      }
      // logs include output emitted between placement and attachment
      const output = (async () => {
        for await (const log of adapter.logs(placed.nativeResourceId!, true, combined)) {
          if (!stdout.write(log.data)) await once(stdout, "drain", { signal: combined })
        }
      })()
      void output.catch(error => controller.abort(error))
      if (state.state === "running") {
        session = await adapter.attach(placed.nativeResourceId!, combined)
        this.sessions.set(sessionId, session)
        await this.resize(sessionId, screenSize)
        session.stream.resume()
        stdin.pipe(session.stream, { end: false })
        for (;;) {
          const current = await adapter.inspect(placed.nativeResourceId!, combined)
          if (!["running", "pending"].includes(current.state)) break
          await delay(100, combined)
        }
      }
      await output
      combined.throwIfAborted()
    } finally {
      clearInterval(renewal)
      controller.abort()
      if (session) stdin.unpipe(session.stream)
      session?.close()
      this.sessions.delete(sessionId)
      await this.coordinator.requestCleanup(workload.id)
    }
  }
}
