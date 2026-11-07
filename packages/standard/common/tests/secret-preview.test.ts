import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { common, network } from "@highstate/library"
import { makeEntity, runtime, secret } from "@highstate/pulumi"
import getKeys from "micro-key-producer/ssh.js"
import { describe, expect, it } from "vitest"
import { createServerEntity, sshPrivateKeyToKeyPair } from "../src/shared/ssh"

runtime.setMocks(
  {
    newResource: args => ({
      id: args.name,
      state: {
        ...args.inputs,
        stdout: args.name.endsWith(".host-key") ? "synthetic-host-key" : "synthetic-hostname",
        stderr: "",
      },
    }),
    call: args => args.inputs,
  },
  "synthetic",
  "preview",
  true,
)

describe.skipIf(!process.env.HIGHSTATE_TEST_PULUMI)("real Pulumi secret-input boundary", () => {
  it("protects credential leaves after server materialization and forUnit reconstruction", async () => {
    const password = "synthetic-password-canary"
    const privateKey = getKeys(new Uint8Array(32).fill(7)).privateKey

    const server = await createServerEntity({
      name: "synthetic",
      endpoints: [
        makeEntity({
          entity: network.l3EndpointEntity,
          identity: "synthetic",
          value: { type: "hostname", hostname: "synthetic.invalid", metadata: {} },
        }),
      ],
      sshPassword: secret(password),
      sshKeyPair: secret(privateKey).apply(sshPrivateKeyToKeyPair),
      waitForPing: false,
      waitForSsh: false,
    })

    const reconstructed = common.serverEntity.schema.parse(JSON.parse(JSON.stringify(server)))

    const config = {
      instanceId: "test.credentials.v1:synthetic",
      stateId: "synthetic",
      args: {},
      inputs: { server: [{ value: reconstructed }] },
      secretValues: { rootPassword: password, sshPrivateKey: privateKey },
      invokedTriggers: [],
      importBasePath: process.cwd(),
    }

    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json([{ result: { data: config } }]),
    })

    const root = await mkdtemp(
      join(process.env.OPENCODE_TMP_DIR ?? tmpdir(), "highstate-secret-preview-"),
    )

    try {
      await mkdir(join(root, "backend"))
      await mkdir(join(root, "node_modules"))

      await mkdir(join(root, "node_modules/@highstate"))

      for (const name of ["contract", "library", "pulumi"]) {
        await symlink(
          fileURLToPath(new URL(`../node_modules/@highstate/${name}`, import.meta.url)),
          join(root, `node_modules/@highstate/${name}`),
          "dir",
        )
      }

      await symlink(
        fileURLToPath(new URL("../", import.meta.url)),
        join(root, "node_modules/@highstate/common"),
        "dir",
      )

      await symlink(
        fileURLToPath(new URL("../../../platform/pulumi/node_modules/@pulumi", import.meta.url)),
        join(root, "node_modules/@pulumi"),
        "dir",
      )

      const fixture = fileURLToPath(new URL("./fixtures/secret-preview.mjs", import.meta.url))
      await copyFile(fixture, join(root, "index.mjs"))

      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "synthetic-secret-preview", type: "module" }),
      )

      await writeFile(
        join(root, "Pulumi.yaml"),
        "name: synthetic-secrets\nruntime: nodejs\nmain: index.mjs\n",
      )

      const env = {
        ...process.env,
        PULUMI_HOME: join(root, "home"),
        PULUMI_BACKEND_URL: `file://${join(root, "backend")}`,
        PULUMI_CONFIG_PASSPHRASE: "synthetic-test-passphrase",
        PULUMI_SKIP_UPDATE_CHECK: "true",
        PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true",
        HIGHSTATE_RUNTIME_ENDPOINT: `http://127.0.0.1:${api.port}`,
        HIGHSTATE_RUNTIME_TOKEN: "synthetic-test-token",
      }

      const run = async (args: string[]) => {
        const child = Bun.spawn([process.env.HIGHSTATE_TEST_PULUMI!, ...args], {
          cwd: root,
          env,
          stdout: "pipe",
          stderr: "pipe",
        })

        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        if (code !== 0) {
          const messages = stdout
            .split("\n")
            .flatMap(line => {
              try {
                return JSON.parse(line).diagnosticEvent?.message ?? []
              } catch {
                return []
              }
            })
            .join("\n")

          const diagnostic = `${stderr}\n${messages || stdout}`
            .replaceAll(password, "[synthetic secret]")
            .replaceAll(privateKey, "[synthetic secret]")
            .replaceAll(JSON.stringify(privateKey).slice(1, -1), "[synthetic secret]")
            .slice(0, 4000)

          throw new Error(`Synthetic Pulumi command failed (${code}): ${diagnostic}`)
        }

        return stdout
      }

      await run(["stack", "init", "test", "--non-interactive"])
      const log = await run(["preview", "--stack", "test", "--non-interactive", "--json", "--diff"])
      expect(log.includes(password)).toBe(false)
      expect(log.includes(privateKey)).toBe(false)
      expect(log.includes(JSON.stringify(privateKey).slice(1, -1))).toBe(false)

      const privateKeyPayload = privateKey
        .split("\n")
        .filter(line => line.length > 0 && !line.startsWith("---"))[2]!

      expect(log.includes(privateKeyPayload)).toBe(false)

      const events = log
        .trim()
        .split("\n")
        .map(line => JSON.parse(line))

      for (const name of [
        "reconstructed-host",
        "materialized-host",
        "output-host",
        "unit-credentials",
        "dependent-host",
      ]) {
        const event = events.find(event =>
          event.resourcePreEvent?.metadata.urn.endsWith(`::${name}`),
        )

        const host = event.resourcePreEvent.metadata.new.inputs.host
        expect(host.hostname).toBe("synthetic-hostname")
        expect(host.ssh.user).toBe("root")
        expect(host.ssh.hostKey).toBe("synthetic-host-key")
        expect(host.ssh.endpoints[0].port).toBe(22)
        expect(host.$meta.identity).toBe(server.$meta.identity)
        expect(host.ssh.keyPair.publicKey).toBe(server.ssh!.keyPair!.publicKey)
        expect(host.ssh.endpoints[0].metadata).toEqual(server.ssh!.endpoints[0].metadata)
        expect(host.ssh.password.value[runtime.specialSigKey]).toBe(runtime.specialSecretSig)

        expect(host.ssh.keyPair.privateKey.value[runtime.specialSigKey]).toBe(
          runtime.specialSecretSig,
        )
      }

      const unknown = events.find(event =>
        event.resourcePreEvent?.metadata.urn.endsWith("::unknown-host"),
      ).resourcePreEvent.metadata.new.inputs.host

      expect(unknown.hostname).toBe("synthetic-hostname")
      expect(unknown.endpoint).toBe(runtime.unknownValue)
      expect(unknown.password.value).toBe(runtime.unknownValue)

      const existing = events.find(event =>
        event.resourcePreEvent?.metadata.urn.endsWith("::existing-secret"),
      ).resourcePreEvent.metadata.new.inputs

      expect(existing.credential[runtime.specialSigKey]).toBe(runtime.specialSecretSig)
    } finally {
      await api.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
