import { PulumiCommand } from "@pulumi/pulumi/automation/index.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createForceAbortableCommand } from "./force-abort"
import { localRunnerBackendConfig } from "./local"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("isolated Pulumi signal forwarding", () => {
  it.each([
    [undefined, true],
    ["true", true],
    ["false", false],
  ])("uses environment value %s to configure unshare", async (value, forwardsSignals) => {
    const config = localRunnerBackendConfig.parse({
      HIGHSTATE_RUNNER_BACKEND_LOCAL_UNSHARE_FORWARD_SIGNALS: value,
    })
    vi.spyOn(PulumiCommand, "get").mockResolvedValue({ command: "pulumi" } as PulumiCommand)
    const spawn = vi.spyOn(Bun, "spawn").mockReturnValue({
      stdout: null,
      stderr: null,
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>)
    const command = await createForceAbortableCommand({
      hostsFilePath: "/tmp/highstate-hosts",
      unshareForwardSignals: config.HIGHSTATE_RUNNER_BACKEND_LOCAL_UNSHARE_FORWARD_SIGNALS,
    })

    // the Automation API's run method is internal
    await (
      command as PulumiCommand & {
        run(args: string[], cwd: string, env: Record<string, string>): Promise<unknown>
      }
    ).run(["version"], "/tmp", {})

    const commandLine = spawn.mock.calls[0]?.[0] as string[]
    expect(commandLine[0]).toBe("unshare")
    expect(commandLine.includes("--forward-signals")).toBe(forwardsSignals)
    expect(commandLine).toContain("--kill-child=SIGKILL")
    expect(commandLine.slice(-2)).toEqual(["version", "--non-interactive"])
  })
})
