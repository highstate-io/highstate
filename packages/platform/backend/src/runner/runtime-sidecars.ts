import type { RuntimeSidecarStartOutput } from "@highstate/contract"
import type {
  RuntimeAdapterProvider,
  RuntimeCoordinator,
  RuntimeDomainContext,
  RuntimeEnvironment,
} from "../container-runtime"
import { runtimeSidecarStartInputSchema } from "@highstate/contract"
import { stableJsonStringify } from "../shared"

type Sidecar = {
  declaration: string
  workloadId: string
  result: Promise<RuntimeSidecarStartOutput>
  consumers: Set<(message: string) => void>
}

/**
 * Sidecars are immutable operation identities; adapters own all native networking and files.
 */
export class RuntimeSidecarManager {
  private readonly operations = new Map<string, Map<string, Sidecar>>()
  private readonly logs = new Map<string, AbortController>()

  constructor(
    private readonly coordinator: RuntimeCoordinator,
    private readonly adapters: RuntimeAdapterProvider,
  ) {}

  async start(
    context: RuntimeDomainContext,
    payload: unknown,
    log: (message: string) => void,
    operationEnvironment?: RuntimeEnvironment,
  ): Promise<RuntimeSidecarStartOutput> {
    const input = runtimeSidecarStartInputSchema.parse(payload)
    const operationId = context.workload.ownerId
    const key = `${context.workload.projectId}/${operationId}`
    const entries = this.operations.get(key) ?? new Map<string, Sidecar>()
    this.operations.set(key, entries)
    const declaration = stableJsonStringify(input)
    const existing = entries.get(input.dnsName)
    if (existing) {
      if (existing.declaration !== declaration) {
        throw new Error(`Sidecar "${input.dnsName}" already exists with different configuration`)
      }

      existing.consumers.add(log)
      return await existing.result
    }

    const consumers = new Set([log])

    const entry: Sidecar = {
      declaration,
      workloadId: "",
      consumers,
      result: Promise.resolve({ id: "", host: "", ports: {} }),
    }

    // insert before the first await so concurrent callers cannot create duplicate identities
    entries.set(input.dnsName, entry)

    entry.result = (async () => {
      const workload = await this.coordinator.createWorkload({
        projectId: context.workload.projectId,
        kind: "sidecar",
        ownerId: operationId,
      })

      entry.workloadId = workload.id
      const adapter = await this.adapters.get(workload.runtimeId)

      const environment =
        operationEnvironment ??
        (await adapter.createEnvironment(this.coordinator.ownership(context.workload)))

      const emit = (message: string) => {
        for (const consumer of consumers) {
          consumer(`\u001b[1;35m[${input.dnsName}]\u001b[0m ${message}`)
        }
      }

      emit("starting sidecar\n")

      try {
        const placed = await this.coordinator.place(workload.id, {
          image: input.image,
          command: input.command,
          args: input.args,
          env: input.env,
          environment,
          aliases: [input.dnsName],
          ports: input.ports.map(port => ({ name: port.name, port: port.containerPort })),
          files: input.files.map(file => ({
            path: file.path,
            data: Buffer.from(file.content),
            mode: file.mode,
            secret: file.secret,
          })),
        })

        const controller = new AbortController()
        this.logs.set(workload.id, controller)
        let output = ""

        const logging = (async () => {
          for await (const chunk of adapter.logs(
            placed.nativeResourceId!,
            true,
            controller.signal,
          )) {
            const text = Buffer.from(chunk.data).toString()
            output = (output + text).slice(-65536)
            emit(text)
          }
        })()

        void logging.catch(error => {
          if (!controller.signal.aborted) {
            emit(`log stream failed: ${String(error)}\n`)
          }
        })

        const renewal = setInterval(() => {
          void this.coordinator
            .renewBackendLease(workload.id, workload.leaseGeneration)
            .catch(() => controller.abort())
        }, 10_000)

        controller.signal.addEventListener("abort", () => clearInterval(renewal), { once: true })

        if (input.readiness) {
          const readiness = input.readiness
          const deadline = Date.now() + readiness.timeoutSeconds * 1000

          const port =
            "port" in readiness ? input.ports.find(port => port.name === readiness.port) : undefined

          if ("port" in readiness && !port) {
            throw new Error("Readiness references an unknown named port")
          }

          for (;;) {
            let ready = readiness.type === "log" && new RegExp(readiness.pattern).test(output)

            if (readiness.type !== "log") {
              // probe from the caller's network namespace, never from the backend host
              const script =
                readiness.type === "http"
                  ? `const r=await fetch(${JSON.stringify(`http://${input.dnsName}:${port!.containerPort}${readiness.path}`)},{signal:AbortSignal.timeout(1000)});process.exit(${JSON.stringify(readiness.statuses)}.includes(r.status)?0:1)`
                  : `const s=await Bun.connect({hostname:${JSON.stringify(input.dnsName)},port:${port!.containerPort},socket:{data(){},open(s){s.end()},error(){process.exit(1)}}});s.end()`

              try {
                const probe = await adapter.exec(context.workload.nativeResourceId!, [
                  "bun",
                  "-e",
                  script,
                ])

                probe.stream.resume()
                ready = (await probe.completed) === 0
              } catch {
                ready = false
              }
            }

            if (ready) {
              break
            }

            if (Date.now() >= deadline) {
              throw new Error(`Sidecar "${input.dnsName}" readiness timed out`)
            }

            await new Promise(resolve => setTimeout(resolve, 200))
          }
        }

        emit("sidecar ready\n")
        return {
          id: workload.id,
          host: input.dnsName,
          ports: Object.fromEntries(
            input.ports.map(port => [port.name, { host: input.dnsName, port: port.containerPort }]),
          ),
        }
      } catch (error) {
        emit(`sidecar failed: ${String(error)}\n`)
        await this.coordinator.requestCleanup(workload.id).catch(() => {})
        throw error
      }
    })()

    return await entry.result
  }

  async finishOperation(projectId: string, operationId: string): Promise<void> {
    const key = `${projectId}/${operationId}`

    for (const entry of this.operations.get(key)?.values() ?? []) {
      await entry.result.catch(() => {})

      if (entry.workloadId) {
        this.logs.get(entry.workloadId)?.abort()
        await this.coordinator.requestCleanup(entry.workloadId)
        this.logs.delete(entry.workloadId)
      }
    }

    this.operations.delete(key)
  }
}
