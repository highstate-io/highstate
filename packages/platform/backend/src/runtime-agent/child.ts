import type { RuntimeMessage } from "./transport"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  type ComponentModel,
  type InstanceModel,
  runtimeResultSubmitInputSchema,
  runtimeSidecarStartInputSchema,
  unitArtifactSchema,
} from "@highstate/contract"
import {
  LocalWorkspace,
  type ProjectRuntime,
  StackNotFoundError,
} from "@pulumi/pulumi/automation/index.js"
import { initTRPC, TRPCError } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import pino from "pino"
import { z } from "zod"
import { evaluateProject } from "../library/worker/evaluator"
import { loadComponents } from "../library/worker/loader.lite"

const pending = new Map<
  string,
  { resolve(message: RuntimeMessage): void; reject(error: unknown): void }
>()
const send = async (message: RuntimeMessage) => {
  await new Promise<void>((resolve, reject) =>
    process.send!(message, error => (error ? reject(error) : resolve())),
  )
}
async function request(message: RuntimeMessage): Promise<RuntimeMessage> {
  const requestId = randomUUID()
  const result = new Promise<RuntimeMessage>((resolve, reject) =>
    pending.set(requestId, { resolve, reject }),
  )
  await send({ ...message, requestId })
  try {
    return await result
  } finally {
    pending.delete(requestId)
  }
}
let started = false
process.on("message", (message: RuntimeMessage) => {
  if (message.requestId) {
    const entry = pending.get(String(message.requestId))
    if (message.error) entry?.reject(new Error(String((message.error as RuntimeMessage).message)))
    else entry?.resolve(message)
    return
  }
  if (started) return
  started = true
  void run(message).then(
    () => process.exit(0),
    async error => {
      await send({ error: { code: "ACTION_FAILED", message: String(error) } })
      process.exit(1)
    },
  )
})

async function run(message: RuntimeMessage): Promise<void> {
  if (message.compositeEvaluationRequest) {
    const input = message.compositeEvaluationRequest as RuntimeMessage
    const manifest = JSON.parse(
      await readFile("/opt/highstate/library/highstate-sources.json", "utf8"),
    ) as { owners: Record<string, string> }
    const modules = [...new Set(Object.values(manifest.owners))].map(
      name => `/opt/highstate/library/node_modules/${name}/dist/index.js`,
    )
    for (const module of modules) await import(module)
    const components = await loadComponents(pino({ level: "warn" }), modules)
    const instances = ((input.instances as RuntimeMessage[]) ?? []).map(fromWireInstance)
    const virtualComponents = Object.fromEntries(
      ((input.virtualComponents as RuntimeMessage[]) ?? []).map(component => [
        String(component.type),
        {
          ...component,
          kind: String(component.kind).endsWith("COMPOSITE") ? "composite" : "unit",
          args: component.arguments ?? {},
          inputs: Object.fromEntries(
            Object.entries((component.inputs as object) ?? {}).map(([key, value]) => [
              key,
              { ...value, type: value.entityType },
            ]),
          ),
          outputs: Object.fromEntries(
            Object.entries((component.outputs as object) ?? {}).map(([key, value]) => [
              key,
              { ...value, type: value.entityType },
            ]),
          ),
        },
      ]),
    ) as Record<string, ComponentModel>
    const resolvedInputs = Object.fromEntries(
      (
        (input.resolvedInputs as {
          instanceId: string
          inputs: { name: string; values: { reference: unknown; entityType: string }[] }[]
        }[]) ?? []
      ).map(instance => [
        instance.instanceId,
        Object.fromEntries(
          instance.inputs.map(input => [
            input.name,
            input.values.map(value => ({ input: value.reference, type: value.entityType })),
          ]),
        ),
      ]),
    )
    const result = evaluateProject(
      pino({ level: "warn" }),
      components,
      virtualComponents,
      instances,
      resolvedInputs as never,
    )
    await send({
      compositeEvaluationResult: {
        librarySnapshotId: input.librarySnapshotId,
        modelRevision: input.modelRevision,
        localOverlayRevision: input.localOverlayRevision,
        ...(result.success
          ? {
              success: {
                virtualInstances: result.virtualInstances.map(toWireInstance),
                errors: Object.entries(result.topLevelErrors).map(([instanceId, message]) => ({
                  instanceId,
                  code: "BRANCH_ERROR",
                  message,
                })),
              },
            }
          : { failure: { code: "INVALID_GRAPH", message: result.error } }),
      },
    })
    return
  }
  const input = message.pulumiActionRequest as RuntimeMessage
  const settings = JSON.parse(
    String((input.stackConfiguration as Record<string, string>).highstate),
  )
  const phase = String(settings.phase)
  const options = settings.options
  const configResponse = options.config
    ? await request({
        unitConfigurationRequest: {
          stateId: settings.stateId,
          phase: options.executionPhase ?? phase,
        },
      })
    : undefined
  const config = configResponse?.unitConfigurationResponse as RuntimeMessage | undefined
  const token = randomUUID()
  let outputs: Record<string, unknown> = {}
  const t = initTRPC.create()
  const router = t.router({
    config: t.router({
      get: t.procedure.query(() => {
        if (!config)
          throw new TRPCError({ code: "NOT_FOUND", message: "Unit configuration is unavailable" })
        return {
          ...config,
          args: config.arguments ?? {},
          inputs: config.inputs ?? {},
          secretValues: config.secretValues ?? {},
          invokedTriggers: config.invokedTriggers ?? [],
        }
      }),
    }),
    result: t.router({
      submit: t.procedure.input(runtimeResultSubmitInputSchema).mutation(async ({ input }) => {
        outputs = input
        await send({ unitResult: { stateId: settings.stateId, outputs: input } })
        return {}
      }),
    }),
    sidecar: t.router({
      start: t.procedure.input(runtimeSidecarStartInputSchema).mutation(async ({ input }) => {
        const response = await request({
          createSidecarRequest: {
            ...input,
            environment: input.env,
            readiness: input.readiness ? { [input.readiness.type]: input.readiness } : undefined,
          },
        })
        const value = response.createSidecarResponse as RuntimeMessage
        return { ...value, id: value.sidecarWorkloadId }
      }),
    }),
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: req => {
      if (req.headers.get("authorization") !== `Bearer ${token}`)
        return new Response("Unauthorized", { status: 401 })
      return fetchRequestHandler({ endpoint: "/trpc", req, router, createContext: () => ({}) })
    },
  })
  const workDir = await mkdtemp("/tmp/highstate-action-")
  const controller = new AbortController()
  process.once("SIGINT", () => controller.abort())
  try {
    const readPath = join(workDir, "artifacts-read")
    const writePath = join(workDir, "artifacts-write")
    await mkdir(readPath)
    await mkdir(writePath)
    for (const hash of settings.artifactHashes ?? []) {
      const response = await fetch(`${settings.artifactUrl}${hash}.tgz`, {
        tls: process.env.HIGHSTATE_AGENT_CA ? { ca: process.env.HIGHSTATE_AGENT_CA } : undefined,
      })
      if (!response.ok || !response.body) throw new Error("Artifact download failed")
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(join(readPath, `${hash}.tgz`)),
      )
    }
    const env = {
      ...(input.stateBackendEnvironment as Record<string, string>),
      ...options.envVars,
      PULUMI_BACKEND_URL: String(input.stateBackendUrl),
      HIGHSTATE_ARTIFACT_READ_PATH: readPath,
      HIGHSTATE_ARTIFACT_WRITE_PATH: writePath,
      HIGHSTATE_RUNTIME_ENDPOINT: `http://127.0.0.1:${server.port}/trpc`,
      HIGHSTATE_RUNTIME_TOKEN: token,
      HIGHSTATE_PULUMI_COMMAND: phase,
      PULUMI_K8S_DELETE_UNREACHABLE: options.deleteUnreachable ? "true" : "false",
    }
    Object.assign(process.env, env)
    const workspaceOptions = {
      workDir,
      envVars: env,
      projectSettings: {
        name: settings.projectName,
        runtime: "bun" as ProjectRuntime,
        main: join(settings.source, "index.js"),
      },
    }
    // historical destroy and refresh must never create an empty replacement stack
    const stack =
      phase === "destroy" || phase === "refresh" || phase === "delete-state"
        ? await LocalWorkspace.selectStack(
            { stackName: String(input.stackName), workDir },
            workspaceOptions,
          )
        : await LocalWorkspace.createOrSelectStack(
            { stackName: String(input.stackName), workDir },
            workspaceOptions,
          )
    const onEvent = async (event: unknown) =>
      await send({
        pulumiEngineEvent: { json: Buffer.from(JSON.stringify(event)).toString("base64") },
      })
    const args = {
      signal: controller.signal,
      onEvent,
      onOutput: (text: string) => process.stdout.write(text),
      refresh: options.refresh,
      debug: Boolean(input.debug),
    }
    if (phase === "delete-state") await stack.workspace.removeStack(stack.name, { force: true })
    else if (phase === "preview") await stack.preview(args)
    else if (phase === "destroy") {
      try {
        await stack.destroy({ ...args, runProgram: options.hasResourceHooks ?? true, remove: true })
      } catch (error) {
        if (!options.forceDeleteState) throw error
        await stack.workspace.removeStack(stack.name, { force: true })
      }
    } else if (phase === "refresh") await stack.refresh(args)
    else await stack.up(args)
    if (phase !== "preview" && outputs.$artifacts) {
      const declared = z.record(z.string(), unitArtifactSchema.array()).parse(outputs.$artifacts)
      for (const artifact of Object.values(declared).flat()) {
        const response = await fetch(`${settings.artifactUrl}${artifact.hash}.tgz`, {
          method: "PUT",
          headers: { "x-highstate-artifact": JSON.stringify(artifact) },
          body: Readable.toWeb(
            createReadStream(join(writePath, `${artifact.hash}.tgz`)),
          ) as unknown as ReadableStream<Uint8Array>,
          tls: process.env.HIGHSTATE_AGENT_CA ? { ca: process.env.HIGHSTATE_AGENT_CA } : undefined,
        })
        if (!response.ok) throw new Error("Artifact upload failed")
      }
    }
    await send({
      actionCompleted: {
        exitCode: 0,
        result: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, { value }])),
      },
    })
  } catch (error) {
    if ((phase !== "destroy" && phase !== "delete-state") || !(error instanceof StackNotFoundError))
      throw error
    await send({ actionCompleted: { exitCode: 0, result: {} } })
  } finally {
    server.stop(true)
    await rm(workDir, { recursive: true, force: true })
  }
}

function fromWireInstance(instance: RuntimeMessage): InstanceModel {
  return {
    ...instance,
    kind: String(instance.kind).endsWith("COMPOSITE") ? "composite" : "unit",
    args: Object.fromEntries(
      ((instance.arguments as { key: string; value: unknown }[]) ?? []).map(arg => [
        arg.key,
        arg.value,
      ]),
    ),
    inputs: unwrapReferences(instance.inputs),
    outputs: unwrapReferences(instance.outputs),
    resolvedOutputs: unwrapReferences(instance.resolvedOutputs),
  } as InstanceModel
}
function unwrapReferences(value: unknown) {
  return Object.fromEntries(
    Object.entries((value as Record<string, { values?: unknown[] }>) ?? {}).map(([key, value]) => [
      key,
      value.values ?? [],
    ]),
  )
}
function toWireInstance(instance: InstanceModel): RuntimeMessage {
  const wrap = (value: unknown) =>
    Object.fromEntries(
      Object.entries((value as object) ?? {}).map(([key, values]) => [key, { values }]),
    )
  return {
    ...instance,
    kind: instance.kind === "composite" ? "COMPONENT_KIND_COMPOSITE" : "COMPONENT_KIND_UNIT",
    arguments: Object.entries(instance.args ?? {}).map(([key, value]) => ({ key, value })),
    inputs: wrap(instance.inputs),
    outputs: wrap(instance.outputs),
    resolvedOutputs: wrap(instance.resolvedOutputs),
  }
}
