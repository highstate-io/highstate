import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { Evidence } from "./evidence"

test("redacts fixture credentials from both published files and printable diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "highstate-evidence-"))
  const evidence = new Evidence(directory)
  const databaseUrl = "postgresql://fixture:disposable-secret@127.0.0.1:5432/test"
  evidence.redact(databaseUrl)
  evidence.redact("disposable-client-secret")

  try {
    await evidence.write("result.json", {
      databaseUrl,
      diagnostic: "disposable-client-secret Bearer fake-token.value",
      status: "failed",
    })

    const published = await readFile(join(directory, "result.json"), "utf8")
    expect(published).not.toContain("disposable-secret")
    expect(published).not.toContain("disposable-client-secret")
    expect(published).not.toContain("fake-token.value")
    expect(JSON.parse(published)).toMatchObject({ status: "failed", databaseUrl: "[redacted]" })

    expect(evidence.sanitize(`Connection failed: ${databaseUrl}`)).toBe(
      "Connection failed: [redacted]",
    )

    await evidence.write("headers.json", {
      diagnostic:
        "Call log:\n  - cookie: session=private-cookie\n  - set-cookie: session=private-response; HttpOnly\n  - authorization: Basic private-basic\nRequest failed",
      headers: { Cookie: "private-cookie", authorization: "Basic private-basic" },
    })

    const headers = await readFile(join(directory, "headers.json"), "utf8")
    expect(headers).not.toContain("private-cookie")
    expect(headers).not.toContain("private-response")
    expect(headers).not.toContain("private-basic")

    expect(JSON.parse(headers).headers).toEqual({
      Cookie: "[redacted]",
      authorization: "[redacted]",
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
