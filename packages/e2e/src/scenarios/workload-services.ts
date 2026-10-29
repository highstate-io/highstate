import type { Clients } from "../harness/clients"
import type { Effects } from "../harness/effects"
import type { Environment } from "../harness/environment"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { ComponentKind, OperationType } from "@highstate/api/v1"
import { designerCall } from "../harness/designer-client"
import { waitFor } from "../harness/wait"
import { runOperation } from "./lifecycle"

type ServicesState = {
  id: string
  instanceId: string
  terminalIds: string[]
  panelIds: string[]
  exportedArtifactIds: string[]
}
type StoredArtifact = { id: string; hash: string }

/**
 * Exercises packaged sidecars, artifact transfer, worker reverse HTTP, and terminal WebSockets through Designer.
 */
export async function workloadServices(
  clients: Clients,
  environment: Environment,
  effects: Effects,
  projectId: string,
  designerUrl: string,
  workerImage: string,
): Promise<void> {
  await clients.library.addLibraryPackage({
    projectId,
    packageName: "@highstate/e2e-library",
    version: "1.0.0",
  })

  const instanceId = "e2e.services.v1:services"

  await clients.model.createNodes({
    projectId,
    instances: [
      {
        id: instanceId,
        name: "services",
        kind: ComponentKind.UNIT,
        type: "e2e.services.v1",
        arguments: Object.entries({ endpoint: effects.url, workerImage }).map(([key, value]) => ({
          key,
          value: { kind: { case: "stringValue", value } },
        })),
      },
    ],
  })

  await runOperation(clients, environment, projectId, [instanceId], OperationType.UPDATE)
  assert.equal(effects.resources.get("services")?.value, "sidecar-file-content")

  const state = await waitFor(
    "worker panel registration",
    async () => {
      const result = await designerCall<{ items: ServicesState[] }>(
        designerUrl,
        "state.getInstanceStates",
        { projectId, pageSize: 100 },
      )

      return result.items.find(state => state.instanceId === instanceId)
    },
    state => Boolean(state?.panelIds.length && state.terminalIds.length),
    90_000,
  )

  assert(state)

  const artifacts = await designerCall<{ items: StoredArtifact[] }>(
    designerUrl,
    "artifactSettings.query",
    { projectId, query: { stateId: state.id, pageSize: 20 } },
  )

  await environment.evidence.write("services-state.json", { state, artifacts })

  assert.equal(artifacts.items.length, 1)
  const artifact = artifacts.items[0]!

  const download = async () => {
    const response = await fetch(
      `${designerUrl}/api/projects/${projectId}/artifacts/${artifact.hash}`,
    )

    assert.equal(response.status, 200, "Persisted artifact must be downloadable through Designer")
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.hash)
    return bytes
  }

  await download()

  const launch = await designerCall<{ url: string }>(
    designerUrl,
    "state.createPanelLaunch",
    { projectId, panelId: state.panelIds[0] },
    true,
  )

  const panelUrl = new URL(launch.url)

  const request = async (path: string, init: RequestInit = {}) =>
    await fetch(`${designerUrl}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), host: panelUrl.host },
    })

  const session = await request(`${panelUrl.pathname}${panelUrl.search}`, { redirect: "manual" })
  assert.equal(session.status, 302)
  const cookie = session.headers.get("set-cookie")?.split(";")[0]
  assert(cookie)
  environment.evidence.redact(cookie)
  environment.evidence.redact(panelUrl.searchParams.get("ticket")!)
  const payload = Buffer.alloc(256 * 1024 + 3)

  for (let i = 0; i < payload.length; i++) {
    payload[i] = i % 251
  }

  const echoed = await request("/echo", {
    method: "POST",
    headers: { cookie, "content-type": "application/octet-stream" },
    body: payload,
  })

  assert.equal(echoed.status, 200)
  assert.equal(echoed.headers.get("x-fixture-worker"), "real-worker")
  assert.deepEqual(Buffer.from(await echoed.arrayBuffer()), payload)
  const streaming = await request("/stream", { method: "POST", headers: { cookie }, body: payload })
  assert.equal(streaming.status, 200)
  const reader = streaming.body!.getReader()
  const started = Date.now()
  const first = await reader.read()

  assert.equal(
    Buffer.from(first.value!).toString(),
    "first-frame\n",
    "Gateway must forward the first frame before EOF",
  )

  assert(Date.now() - started < 1200, "Gateway must not buffer the delayed response")
  const chunks: Uint8Array[] = []

  for (;;) {
    const next = await reader.read()
    if (next.done) {
      break
    }

    chunks.push(next.value)
  }

  assert.deepEqual(Buffer.concat(chunks), payload)

  const terminal = await designerCall<{ id: string }>(
    designerUrl,
    "terminal.getOrCreateTerminalSession",
    { projectId, terminalId: state.terminalIds[0], newSession: true },
    true,
  )

  const socket = new WebSocket(
    `${designerUrl.replace("http:", "ws:")}/api/projects/${projectId}/terminal-sessions/${terminal.id}?screenSize=103x37`,
  )

  let output = ""
  socket.binaryType = "arraybuffer"

  socket.addEventListener("message", event => {
    output += typeof event.data === "string" ? event.data : Buffer.from(event.data).toString()
  })

  try {
    await waitFor(
      "terminal websocket",
      async () => socket.readyState,
      state => state === WebSocket.OPEN,
      30_000,
    )

    socket.send(
      Buffer.from("tar -xOzf /tmp/payload.tgz; stty size; printf 'terminal-%s\\n' roundtrip\n"),
    )

    await waitFor(
      "terminal command output",
      async () => output,
      value =>
        value.includes("durable-artifact-content") &&
        value.includes("terminal-roundtrip") &&
        value.includes("37 103"),
      30_000,
    )

    socket.send(JSON.stringify({ type: "resize", cols: 117, rows: 41 }))
    // a server round trip before stty avoids racing asynchronous WebSocket control handling
    await Bun.sleep(250)
    socket.send(Buffer.from("stty size; exit\n"))

    await waitFor(
      "terminal resize",
      async () => output,
      value => value.includes("41 117"),
      30_000,
    )
  } finally {
    socket.close()
  }

  await environment.evidence.write("terminal-gateway.log", output)
  await runOperation(clients, environment, projectId, [instanceId], OperationType.DESTROY)
  assert.equal(effects.resources.size, 0)

  const collected = await fetch(
    `${designerUrl}/api/projects/${projectId}/artifacts/${artifact.hash}`,
  )

  assert.equal(
    collected.status,
    404,
    "Destroy must collect artifacts after their final reference is removed",
  )

  await environment.evidence.write("workload-services.json", {
    status: "passed",
    sidecarDnsAndFiles: true,
    artifactHash: artifact.hash,
    artifactCollectedAfterDestroy: true,
    panelBinaryRoundtripBytes: payload.length,
    panelStreamedBeforeEof: true,
    terminalInputOutput: true,
    terminalResize: true,
  })
}
