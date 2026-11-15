import { createHash, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import {
  type ContainerRuntimeAdapter,
  ownershipLabels,
  type RuntimeOwnership,
  type WorkloadIntent,
} from "@highstate/backend"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { Evidence } from "../harness/evidence"
import { provisionRuntime, type RuntimeFixture, runtimeEngine } from "../infra/runtime"
import { observeSession } from "../runtimes/session"

const engine = runtimeEngine()
const id = `hs-e2e-${randomUUID().slice(0, 12)}`
const evidence = new Evidence(
  resolve(import.meta.dirname, "../../../..", ".artifacts/e2e", id, engine),
)
const results: { name: string; state: string | undefined }[] = []
const owners: RuntimeOwnership[] = []
let fixture: RuntimeFixture | undefined
let adapter: ContainerRuntimeAdapter
const image = "mirror.gcr.io/library/busybox:1.37"
const owner = (name: string): RuntimeOwnership => {
  const value: RuntimeOwnership = {
    backendId: id,
    projectId: id,
    runtimeId: id,
    workloadId: `${id}-${name}`,
    kind: "worker",
    generation: 1,
  }

  owners.push(value)
  return value
}

async function eventually(check: () => Promise<void>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs

  while (true) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() > deadline) {
        throw error
      }

      await Bun.sleep(500)
    }
  }
}

async function place(intent: WorkloadIntent) {
  const workload = await adapter.place(intent)
  await eventually(async () => expect((await adapter.inspect(workload.id)).state).toBe("running"))
  return workload
}

async function exec(id: string, script: string, code = 0) {
  const session = await adapter.exec(id, ["sh", "-ec", script])
  const observed = observeSession(session)

  try {
    expect(await session.completed, observed.output()).toBe(code)
    await observed.waitFor("conformance-done")
    return observed.output()
  } finally {
    session.close()
  }
}

describe(`real ${engine} runtime conformance`, () => {
  afterEach(async context => {
    if (context.task.result?.state === "fail") {
      await fixture?.diagnose?.()
    }

    context.onTestFinished(async () => {
      results.push({ name: context.task.name, state: context.task.result?.state })
      await evidence.write("tests.json", results)
    })
  })

  beforeAll(async () => {
    try {
      fixture = await provisionRuntime(engine, id, evidence)
      adapter = fixture.adapter

      await evidence.write("run.json", {
        id,
        engine,
        transport: fixture.transport,
        capabilities: adapter.capabilities,
      })
    } catch (error) {
      await evidence.write("setup-failure.json", { id, engine, error: String(error) })
      throw error
    }
  }, 600_000)

  afterAll(async () => {
    if (!fixture) {
      return
    }

    try {
      const before = await adapter.discoverResources({ "highstate.io/backend": id })
      await evidence.write("resources-before-cleanup.json", before)
      const failures: unknown[] = []

      for (const value of owners.toReversed()) {
        try {
          await adapter.cleanup(value)
        } catch (error) {
          failures.push(String(error))
        }
      }

      for (const resource of before.filter(
        value => value.type === "volume" || value.type === "pvc",
      )) {
        const value = owners.find(
          owner => owner.workloadId === resource.labels["highstate.io/workload"],
        )

        if (!value) {
          throw new Error("Cannot identify volume owner")
        }

        try {
          await adapter.removeVolume(value, resource.id.replace(/^pvc\//, ""))
        } catch (error) {
          failures.push(String(error))
        }
      }

      await eventually(async () =>
        expect(await adapter.discoverResources({ "highstate.io/backend": id })).toEqual([]),
      )

      await evidence.write(
        "resources-after-cleanup.json",
        await adapter.discoverResources({ "highstate.io/backend": id }),
      )

      expect(failures).toEqual([])
      await evidence.write("cleanup-result.json", { state: "passed" })
    } catch (error) {
      await evidence.write("cleanup-result.json", { state: "failed", error: String(error) })
      throw error
    } finally {
      await fixture.dispose()
    }
  }, 180_000)

  test("preflight and immutable image identity reach the actual engine", async () => {
    const checks = await adapter.preflight()
    await evidence.write("preflight.json", checks)

    expect(checks.filter(check => check.name !== "local-overlay").every(check => check.ok)).toBe(
      true,
    )

    const identity = await adapter.ensureImage("docker.io/library/busybox:1.37")
    expect(identity.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(await adapter.verifyImage(identity)).toBe(true)

    expect(await adapter.verifyImage({ ...identity, digest: `sha256:${"0".repeat(64)}` })).toBe(
      false,
    )

    await evidence.write("image.json", identity)
  }, 180_000)

  test("files, secret permissions, binary transfer, exec status and logs", async () => {
    const value = owner("files")
    const secret = randomUUID()
    evidence.redact(secret)

    const intent: WorkloadIntent = {
      owner: value,
      image,
      command: ["sh", "-ec"],
      args: ["echo conformance-stdout; echo conformance-stderr >&2; exec sleep 600"],
      files: [
        { path: "/tmp/input", data: Buffer.from("file-content"), mode: 0o640 },
        { path: "/run/highstate/credential", data: Buffer.from(secret), secret: true, mode: 0o400 },
      ],
      env: { CONFORMANCE_ENV: "environment-content" },
    }

    const workload = await place(intent)
    expect((await adapter.place(intent)).id).toBe(workload.id)

    await expect(adapter.place({ ...intent, env: { CONFORMANCE_ENV: "changed" } })).rejects.toThrow(
      /changed/i,
    )

    expect((await adapter.discover(ownershipLabels(value))).map(item => item.id)).toContain(
      workload.id,
    )

    const output = await exec(
      workload.id,
      `test "$(cat /tmp/input)" = file-content; test "$(sha256sum /run/highstate/credential)" = '${createHash("sha256").update(secret).digest("hex")}  /run/highstate/credential'; test "$(stat -c %a /run/highstate/credential)" = 400; test "$CONFORMANCE_ENV" = environment-content; echo conformance-done`,
    )

    expect(output).toContain("conformance-done")
    const binary = Buffer.from([0, 255, 1, 128, 10])
    await adapter.putFiles(workload.id, [{ path: "/tmp/transferred", data: binary, mode: 0o600 }])

    expect(
      await exec(
        workload.id,
        'od -An -tx1 /tmp/transferred; test "$(stat -c %a /tmp/transferred)" = 600; echo conformance-done',
      ),
    ).toContain("00 ff 01 80 0a")

    await exec(workload.id, "echo conformance-done; exit 23", 23)
    let logs = ""

    for await (const entry of adapter.logs(workload.id)) {
      logs += Buffer.from(entry.data).toString()
    }

    expect(logs).toContain("conformance-stdout")
    expect(logs).toContain("conformance-stderr")
    expect(logs).not.toContain(secret)
    await evidence.write("workload.log", logs)
  }, 180_000)

  test("operation-scoped DNS aliases carry real HTTP traffic", async () => {
    const environment = await adapter.createEnvironment(owner("network"))
    expect((await adapter.createEnvironment(environment.owner)).id).toBe(environment.id)

    await place({
      owner: owner("server"),
      image,
      environment,
      aliases: ["conformance.internal"],
      ports: [{ name: "http", port: 8080 }],
      command: ["sh", "-ec"],
      args: [
        "mkdir -p /tmp/www; echo network-content >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www",
      ],
    })

    const client = await place({
      owner: owner("client"),
      image,
      environment,
      command: ["sleep", "600"],
    })

    await eventually(async () => {
      const result = await exec(
        client.id,
        "wget -T 3 -qO- http://conformance.internal:8080; echo conformance-done",
      )

      expect(result).toContain("network-content")
    })

    await evidence.write("network.json", {
      alias: "conformance.internal",
      httpContentVerified: true,
    })
  }, 240_000)

  test("persistent volume survives workload cleanup and rejects another owner", async () => {
    const value = owner("volume")
    const volume = { name: `${id}-data`, mountPath: "/data", size: "64Mi" }
    const first = await place({ owner: value, image, volumes: [volume], command: ["sleep", "600"] })
    await exec(first.id, "echo persistent-content >/data/value; echo conformance-done")
    await adapter.cleanup(value)
    const retained = await adapter.discoverResources(ownershipLabels(value))
    expect(retained.some(item => item.type === "volume" || item.type === "pvc")).toBe(true)

    await expect(
      adapter.ensureVolume({ ...value, projectId: `${id}-foreign` }, volume),
    ).rejects.toThrow(/another owner/i)

    const second = await place({
      owner: { ...value, generation: 2 },
      image,
      volumes: [volume],
      command: ["sleep", "600"],
    })

    expect(await exec(second.id, "cat /data/value; echo conformance-done")).toContain(
      "persistent-content",
    )

    await evidence.write("volume.json", {
      retainedAfterCleanup: true,
      contentSurvived: true,
      ownershipEnforced: true,
    })
  }, 240_000)

  test("attach exchanges stdin and terminal resize changes the actual PTY", async () => {
    const workload = await place({ owner: owner("terminal"), image, tty: true, command: ["sh"] })
    const attached = await adapter.attach(workload.id)
    const observed = observeSession(attached)

    try {
      await attached.resize(103, 37)
      attached.stream.write("stty size; printf 'attach-%s\\n' roundtrip\n")
      await observed.waitFor("attach-roundtrip")
      await observed.waitFor("37 103")
      const execution = await adapter.exec(workload.id, ["sh"], { tty: true })
      const terminal = observeSession(execution)

      try {
        await execution.resize(117, 41)
        execution.stream.write("stty size; printf 'exec-%s\\n' roundtrip\n")
        await terminal.waitFor("exec-roundtrip")
        await terminal.waitFor("41 117")
        execution.stream.write("exit 0\n")
        expect(await execution.completed).toBe(0)
      } finally {
        execution.close()
      }

      await evidence.write("terminal.json", {
        attachRoundtrip: true,
        attachSize: [103, 37],
        execSize: [117, 41],
      })
    } finally {
      attached.close()
    }
  }, 120_000)

  test("builds a frozen snapshot and executes the verified image", async () => {
    const builder = fixture!.publication?.adapter ?? adapter
    const base = await adapter.ensureImage("mirror.gcr.io/oven/bun:1.3.13")
    const snapshotHash = createHash("sha256").update(id).digest("hex")
    const phases: string[] = []

    const built = await builder.buildImage(
      {
        owner: owner("build"),
        snapshotId: id,
        snapshotHash,
        baseImage: base.reference,
        repository: fixture!.publication?.repository,
        files: [
          {
            path: "package.json",
            data: Buffer.from(
              JSON.stringify({
                name: "conformance-snapshot",
                private: true,
                dependencies: { "conformance-dependency": "file:./dependency" },
              }),
            ),
          },
          {
            path: "dependency/package.json",
            data: Buffer.from(JSON.stringify({ name: "conformance-dependency", version: "1.0.0" })),
          },
          {
            path: "bun.lock",
            data: Buffer.from(
              JSON.stringify({
                lockfileVersion: 1,
                configVersion: 1,
                workspaces: {
                  "": {
                    name: "conformance-snapshot",
                    dependencies: { "conformance-dependency": "file:./dependency" },
                  },
                },
                packages: {
                  "conformance-dependency": ["conformance-dependency@file:dependency", {}],
                },
              }),
            ),
          },
          { path: "marker.txt", data: Buffer.from("built-snapshot-content") },
        ],
      },
      async phase => {
        phases.push(phase)
      },
      AbortSignal.timeout(240_000),
    )

    expect(built.imageHash).toBe(snapshotHash)
    expect(await builder.verifyImage(built)).toBe(true)

    if (engine !== "local-docker") {
      expect(built.reference).toMatch(/@sha256:[a-f0-9]{64}$/)
      expect(built.reference.startsWith(fixture!.publication!.repository)).toBe(true)
      expect(phases).toContain("pushing")
    }

    expect(phases).toContain("building")
    expect(phases).toContain("verifying")

    const workload = await place({
      owner: owner("built"),
      image: built.reference,
      command: ["sleep", "600"],
    })

    expect(
      await exec(
        workload.id,
        "test -f /opt/highstate/library/node_modules/conformance-dependency/package.json; cat /opt/highstate/library/marker.txt; echo conformance-done",
      ),
    ).toContain("built-snapshot-content")

    await evidence.write("build.json", { built, phases, executed: true })
  }, 300_000)

  if (engine !== "local-docker") {
    test("rejects snapshot builds without a required registry repository", async () => {
      await expect(
        adapter.buildImage(
          {
            owner: owner("build"),
            snapshotId: id,
            snapshotHash: createHash("sha256").update(id).digest("hex"),
            baseImage: image,
            files: [],
          },
          async () => {},
        ),
      ).rejects.toThrow(/require.*repository/i)

      await evidence.write("build-repository-required.json", {
        repositoryRequired: true,
      })
    })
  }
})
