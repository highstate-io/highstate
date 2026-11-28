import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getEntityId, z } from "@highstate/contract"
import { dns } from "@highstate/library"
import {
  automation,
  ComponentResource,
  makeEntity,
  output,
  type ResourceOptions,
  rootStackResource,
  toPromise,
} from "@highstate/pulumi"
import { local } from "@pulumi/command"
import { describe, expect, it, vi } from "vitest"
import { DnsRecordSet, dnsRecordMediator } from "../src/shared/dns"
import * as dnsWait from "../src/shared/dns-wait"

type RecordState = { type: string; value: string }

// Runs a real Pulumi engine against a local fake DNS provider; no cloud credentials are used.
describe.skipIf(process.env.HIGHSTATE_TEST_PULUMI !== "1")("DNS lifecycle engine ordering", () => {
  it("migrates unchanged legacy records, then reconciles CNAME and dual-stack addresses", async () => {
    const directory = mkdtempSync(join(tmpdir(), "highstate-dns-lifecycle-"))
    const statePath = join(directory, "records.json")
    const fixture = fileURLToPath(new URL("./fixtures/dns-record.cjs", import.meta.url))
    writeFileSync(statePath, "{}")
    let values: RecordState[] = [{ type: "CNAME", value: "target.example.com" }]
    let legacy = true
    let failCreate = false

    const provider = makeEntity({
      entity: dns.providerEntity,
      identity: "test",
      value: { zones: ["example.com"], implRef: { package: "test", data: {} } },
    })

    class FakeDnsRecord extends ComponentResource {
      constructor(name: string, record: RecordState, opts?: ResourceOptions) {
        super("test:DnsRecord", name, {}, opts)

        new local.Command(
          name,
          {
            create: failCreate
              ? "sleep 1; exit 1"
              : `node "${fixture}" "${statePath}" create ${record.type} ${record.value}`,
            delete: `node "${fixture}" "${statePath}" delete ${record.type} ${record.value}`,
          },
          legacy ? opts : { ...opts, parent: this, aliases: [{ parent: rootStackResource }] },
        )
      }
    }

    const implementation = dnsRecordMediator.implement(
      z.object({}),
      async ({ name, args, dependsOn, replaceWith }) => {
        const record = await toPromise(output({ type: args.type, value: args.value }))
        return new FakeDnsRecord(name, record, { dependsOn, replaceWith })
      },
    )

    const mediator = vi
      .spyOn(dnsRecordMediator, "call")
      .mockImplementation(async (_implRef, input) => {
        return implementation(await toPromise(output(input)), {})
      })

    const stack = await automation.LocalWorkspace.createOrSelectStack(
      {
        stackName: "test",
        projectName: "dns-lifecycle",
        program: async () => {
          if (legacy) {
            const set = new ComponentResource("highstate:common:DnsRecordSet", "records", {})

            for (const record of values) {
              const name = `service.example.com.${getEntityId(provider)}.${record.value}`
              new ComponentResource("highstate:common:DnsRecord", name, {}, { parent: set })
              new FakeDnsRecord(name, record)
            }
          } else {
            const set = new DnsRecordSet("records", {
              name: "service.example.com",
              providers: [provider],
              values: values.map(record => record.value),
              waitAt: failCreate ? "local" : undefined,
            })

            await toPromise(set.waitCommands)
          }
        },
      },
      {
        workDir: directory,
        envVars: { PULUMI_BACKEND_URL: `file://${directory}`, PULUMI_CONFIG_PASSPHRASE: "" },
      },
    )

    try {
      await stack.up()

      // establish the new dependency without changing values on the first upgrade
      legacy = false
      const migration = await stack.up()
      expect(migration.summary.resourceChanges?.delete ?? 0).toBe(0)
      expect(migration.summary.resourceChanges?.replace ?? 0).toBe(0)
      expect(Object.values(JSON.parse(readFileSync(statePath, "utf8")))).toEqual(values)

      const unchanged = await stack.up()
      expect(unchanged.summary.resourceChanges?.create ?? 0).toBe(0)
      expect(unchanged.summary.resourceChanges?.replace ?? 0).toBe(0)

      values = [{ type: "CNAME", value: "other-target.example.com" }]
      await stack.up()
      expect(Object.values(JSON.parse(readFileSync(statePath, "utf8")))).toEqual(values)

      values = [
        { type: "A", value: "192.0.2.1" },
        { type: "AAAA", value: "2001:db8::1" },
      ]

      await stack.up()

      expect(Object.values(JSON.parse(readFileSync(statePath, "utf8")))).toEqual(
        expect.arrayContaining(values),
      )

      values = [
        { type: "A", value: "192.0.2.1" },
        { type: "AAAA", value: "2001:db8::2" },
      ]

      const addressChange = await stack.up()
      expect(addressChange.summary.resourceChanges?.replace ?? 0).toBe(0)

      values = [{ type: "CNAME", value: "new-target.example.com" }]
      await stack.up()
      expect(Object.values(JSON.parse(readFileSync(statePath, "utf8")))).toEqual(values)
      await stack.destroy()

      // A failing provider must prevent the wait from running, rather than racing it.
      failCreate = true
      values = [{ type: "A", value: "192.0.2.1" }]

      const wait = vi
        .spyOn(dnsWait, "getDnsWaitScript")
        .mockReturnValue(output("echo dns-wait-ran"))

      try {
        await expect(stack.up()).rejects.toThrow()
        const state = await stack.exportStack()

        const waits = state.deployment.resources.filter(
          (resource: { type: string; urn: string }) =>
            resource.type === "command:local:Command" && resource.urn.includes("wait-for-dns"),
        )

        expect(waits).toEqual([])
      } finally {
        wait.mockRestore()
        await stack.destroy()
      }
    } finally {
      mediator.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 180_000)
})
