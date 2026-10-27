import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ActionProcesses } from "./processes"
import { connectRuntimeAgent, type RuntimeMessage, writeRuntimeMessage } from "./transport"

export async function runRuntimeAgent(): Promise<void> {
  const scope = JSON.parse(process.env.HIGHSTATE_AGENT_SCOPE ?? "{}")
  const stream = await connectRuntimeAgent({
    url: process.env.HIGHSTATE_AGENT_URL!,
    token: process.env.HIGHSTATE_AGENT_TOKEN!,
    ca: process.env.HIGHSTATE_AGENT_CA,
    protocolRoot: process.env.HIGHSTATE_PROTOCOL_ROOT ?? "/opt/highstate/protocol",
    vendorRoot: process.env.HIGHSTATE_VENDOR_ROOT ?? "/opt/highstate/vendor/googleapis",
  })
  const processes = new ActionProcesses()
  const send = async (message: RuntimeMessage) => await writeRuntimeMessage(stream, message)
  await send({
    clientHello: {
      minimumProtocolVersion: 1,
      maximumProtocolVersion: 1,
      backendId: scope.backendId,
      projectId: scope.projectId,
      containerRuntimeId: scope.runtimeId,
      workloadId: scope.workloadId,
      workloadKind:
        scope.kind === "pulumi" ? "WORKLOAD_KIND_PULUMI" : "WORKLOAD_KIND_COMPOSITE_EVALUATION",
      leaseGeneration: scope.generation,
    },
  })
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let hello = false
  let sequence = 0
  try {
    for await (const message of stream) {
      if (!hello) {
        if (!message.serverHello) throw new Error("ServerHello must be the first backend message")
        hello = true
        const lease = Number((message.serverHello as RuntimeMessage).leaseDurationMs)
        heartbeat = setInterval(
          () => {
            void send({ heartbeat: { sequence: String(++sequence) } }).catch(() => stream.destroy())
          },
          Math.max(100, Math.floor(lease / 3)),
        )
        continue
      }
      const actionId = String(message.actionId ?? "")
      if (message.cancelRequest) {
        const accepted = processes.cancel(
          actionId,
          Boolean((message.cancelRequest as RuntimeMessage).force),
        )
        await send({ actionId, requestId: message.requestId, cancelResponse: { accepted } })
      } else if (message.pulumiActionRequest || message.compositeEvaluationRequest) {
        if (!actionId) throw new Error("Runtime action ID is required")
        let terminal = false
        void processes
          .start(
            actionId,
            join(dirname(fileURLToPath(import.meta.url)), "child.js"),
            message,
            async event => {
              const value = event as RuntimeMessage
              terminal ||= Boolean(
                value.actionCompleted ||
                  value.compositeEvaluationResult ||
                  (value.error && !value.requestId),
              )
              await send({ ...value, actionId })
            },
            async (data, stderr) => {
              await send({
                actionId,
                actionOutput: {
                  channel: stderr ? "OUTPUT_CHANNEL_STDERR" : "OUTPUT_CHANNEL_STDOUT",
                  data: data.toString("base64"),
                },
              })
            },
          )
          .catch(async error => {
            if (!terminal)
              await send({
                actionId,
                error: { code: "ACTION_FAILED", message: String(error) },
              }).catch(() => {})
          })
      } else processes.respond(actionId, message)
    }
  } finally {
    clearInterval(heartbeat)
    processes.stop()
    stream.cancel()
  }
}

if (import.meta.main) await runRuntimeAgent()
