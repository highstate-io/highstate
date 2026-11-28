import { spawnSync } from "node:child_process"
import { toPromise } from "@highstate/pulumi"
import { describe, expect, it } from "vitest"
import { getDnsWaitScript } from "../src/shared/dns-wait"

describe("DNS propagation checks", () => {
  async function run(answer: string, value?: string) {
    const script = await toPromise(getDnsWaitScript("service.example.com", value))
    return spawnSync(
      "sh",
      ["-c", `getent() { printf '%s\\n' "$ANSWER"; }; sleep() { :; }; ${script}`],
      {
        encoding: "utf8",
        env: { ...process.env, ANSWER: answer },
        timeout: 2000,
      },
    )
  }

  it("accepts the exact address in the first field", async () => {
    expect((await run("192.0.2.1 service.example.com", "192.0.2.1")).status).toBe(0)
  })

  it.each([
    "192.0.2.10 service.example.com",
    "192.0.2.1.9 service.example.com",
    "192.0.2.2 192.0.2.1",
  ])("times out on a different address or a matching hostname: %s", async answer => {
    const result = await run(answer, "192.0.2.1")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("DNS propagation timed out for service.example.com")
  })

  it("accepts any resolved address for proxied records", async () => {
    expect((await run("192.0.2.2 service.example.com")).status).toBe(0)
  })

  it("bounds failed lookups even for proxied records", async () => {
    const script = await toPromise(getDnsWaitScript("service.example.com"))

    const result = spawnSync("sh", ["-c", `getent() { return 2; }; sleep() { :; }; ${script}`], {
      encoding: "utf8",
      timeout: 2000,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("DNS propagation timed out")
  })
})
