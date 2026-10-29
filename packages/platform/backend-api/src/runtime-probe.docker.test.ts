import type { AddressInfo } from "node:net"
import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, vi } from "vitest"
import {
  AgentConnectionRegistry,
  DockerRuntimeAdapter,
  RuntimeCoordinator,
  RuntimeCredentialSigner,
  RuntimeWorkloadProbe,
  type WorkloadIntent,
} from "../../backend/src"
import { test } from "../../backend/src/test-utils/services"
import { startRuntimeServer } from "./runtime-server"

// Opt in with HIGHSTATE_TEST_DOCKER_RUNTIME_PROBE=1; requires a daemon-local checkout and Docker bridge access.
test.skipIf(process.env.HIGHSTATE_TEST_DOCKER_RUNTIME_PROBE !== "1")(
  "probes a real Docker agent over verified TLS and rejects an untrusted listener",
  async ({ database, project }) => {
    const host = execFileSync(
      "docker",
      ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"],
      { encoding: "utf8" },
    ).trim()

    const directory = mkdtempSync(join(tmpdir(), "highstate-docker-probe-"))
    writeFileSync(join(directory, "hosts"), `127.0.0.1 localhost\n${host} runtime-probe.test\n`)
    const root = fileURLToPath(new URL("../../../..", import.meta.url))
    const runnerImage = process.env.HIGHSTATE_TEST_RUNNER_IMAGE
    const protocolRoot = join(directory, "protocol")
    cpSync(join(root, "packages/platform/api/protocol"), protocolRoot, { recursive: true })
    mkdirSync(join(protocolRoot, "google/protobuf"), { recursive: true })

    // supply the standard descriptor imported by google/api annotations alongside application schemas
    copyFileSync(
      join(
        root,
        "packages/platform/backend/node_modules/protobufjs/google/protobuf/descriptor.proto",
      ),
      join(protocolRoot, "google/protobuf/descriptor.proto"),
    )

    const adapter = new DockerRuntimeAdapter({
      endpoint: "unix:///var/run/docker.sock",
      local: true,
    })

    const agentLogs: string[] = []
    const nativeCleanup = adapter.cleanup.bind(adapter)

    vi.spyOn(adapter, "cleanup").mockImplementation(async owner => {
      try {
        for (const native of await adapter.discover({
          "highstate.io/workload": owner.workloadId,
        })) {
          for await (const log of adapter.logs(native.id)) {
            agentLogs.push(Buffer.from(log.data).toString())
          }
        }
      } finally {
        await nativeCleanup(owner)
      }
    })

    const nativePlace = adapter.place.bind(adapter)

    vi.spyOn(adapter, "place").mockImplementation(
      async (intent: WorkloadIntent, signal?: AbortSignal) =>
        await nativePlace(
          {
            ...intent,
            localBinds: [
              ...(!runnerImage
                ? [
                    { source: root, target: root, readOnly: true },
                    { source: directory, target: directory, readOnly: true },
                  ]
                : []),
              { source: join(directory, "hosts"), target: "/etc/hosts", readOnly: true },
            ],
            env: {
              ...intent.env,
              ...(!runnerImage
                ? {
                    HIGHSTATE_PROTOCOL_ROOT: protocolRoot,
                    HIGHSTATE_VENDOR_ROOT: join(root, "packages/platform/api/vendor/googleapis"),
                  }
                : {}),
            },
          },
          signal,
        ),
    )

    const coordinator = new RuntimeCoordinator(
      database,
      { get: async () => adapter },
      new RuntimeCredentialSigner("docker-probe", new Uint8Array(32)),
      new AgentConnectionRegistry(),
      "docker-probe",
    )

    const authenticated = vi.spyOn(coordinator, "authenticate")
    let shutdown: (() => Promise<void>) | undefined

    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          "/CN=runtime-probe.test",
          "-addext",
          "subjectAltName=DNS:runtime-probe.test",
          "-keyout",
          join(directory, "key.pem"),
          "-out",
          join(directory, "cert.pem"),
        ],
        { stdio: "ignore" },
      )

      const cert = readFileSync(join(directory, "cert.pem"), "utf8")

      const server = await startRuntimeServer(coordinator, {
        host: "0.0.0.0",
        port: 0,
        tls: { key: readFileSync(join(directory, "key.pem")), cert },
      })

      shutdown = server.shutdown
      const runtimeId = project.containerRuntimeId!

      const runtime = await database.backend.containerRuntime.findUniqueOrThrow({
        where: { id: runtimeId },
      })

      const spec = {
        ...runtime.spec,
        runtimeApiUrl: `https://runtime-probe.test:${(server.address as AddressInfo).port}`,
        runtimeApiCaBundle: cert,
      }

      await database.backend.containerRuntime.update({ where: { id: runtimeId }, data: { spec } })

      const probe = new RuntimeWorkloadProbe(database, coordinator, {
        image:
          runnerImage ?? process.env.HIGHSTATE_TEST_DOCKER_PROBE_IMAGE ?? "oven/bun:1.3.13-debian",
        agent: {
          binary: "bun",
          path: runnerImage
            ? "/opt/highstate/runtime-agent/main.js"
            : join(root, "packages/platform/backend/src/runtime-agent/main.ts"),
        },
        timeoutMs: 5000,
      })

      try {
        await probe.probe(runtimeId)
      } catch (cause) {
        throw new Error(`Docker agent probe failed with logs: ${agentLogs.join("")}`, { cause })
      }

      expect(authenticated).toHaveBeenCalled()
      const authenticatedCount = authenticated.mock.calls.length

      await database.backend.containerRuntime.update({
        where: { id: runtimeId },
        data: { spec: { ...spec, runtimeApiCaBundle: undefined } },
      })

      await expect(probe.probe(runtimeId)).rejects.toThrow("timed out")
      expect(authenticated).toHaveBeenCalledTimes(authenticatedCount)

      const workloads = await database.backend.runtimeWorkload.findMany({
        where: { projectId: project.id, ownerId: { startsWith: "runtime-probe:" } },
      })

      expect(workloads).toHaveLength(2)

      for (const workload of workloads) {
        expect(workload.cleanedUpAt).toBeInstanceOf(Date)
        expect(await adapter.discover({ "highstate.io/workload": workload.id })).toEqual([])
      }
    } finally {
      try {
        await coordinator.cleanupProject(project.id)
      } finally {
        await shutdown?.()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  },
  60_000,
)
