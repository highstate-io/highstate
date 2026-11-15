import type { execa } from "execa"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ProjectKeyringStorage as RealProjectKeyringStorage } from "./project-keyring-storage"

const run = vi.fn()

class ProjectKeyringStorage extends RealProjectKeyringStorage {
  constructor() {
    super(run as typeof execa)
  }
}

describe("ProjectKeyringStorage", () => {
  beforeEach(() => {
    run.mockReset()
  })

  test("reads keyring credentials through the helper's private output pipe", async () => {
    const credentials = [{ account: "identity", password: "secret identity" }]
    run.mockResolvedValue({ stdout: JSON.stringify(credentials), failed: false })
    expect(await new ProjectKeyringStorage().read()).toEqual(credentials)
    expect(JSON.parse(run.mock.calls[0]![2].input)).toEqual({ operation: "read" })
  })

  test("writes secrets through stdin rather than process arguments", async () => {
    run.mockResolvedValue({ stdout: "null", failed: false })
    await new ProjectKeyringStorage().write("identity", "secret identity")
    const [, args, options] = run.mock.calls[0]!
    expect(args.join(" ")).not.toContain("secret identity")

    expect(JSON.parse(options.input)).toEqual({
      operation: "write",
      account: "identity",
      value: "secret identity",
    })
  })

  test("reports helper failures without including captured secret output", async () => {
    run.mockResolvedValue({
      stdout: "secret identity",
      stderr: "Keyring unavailable",
      failed: true,
    })

    let failure: unknown

    try {
      await new ProjectKeyringStorage().read()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain("System keyring read failed")
    expect((failure as Error).cause).toEqual(new Error("Keyring unavailable"))
    expect(String(failure)).not.toContain("secret identity")
  })
})
