import { runtimeSidecarStartInputSchema } from "@highstate/contract"
import { PulumiCommand } from "@pulumi/pulumi/automation/index.js"
import { pino } from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createForceAbortableCommand, probeHostsNamespace } from "./force-abort"
import { localRunnerBackendConfig } from "./local"
import { SidecarTracker } from "./sidecar-tracker"

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

it("runs Pulumi directly when hosts isolation is denied and rejects sidecars", async () => {
  const denial = "unshare: unshare failed: Operation not permitted"
  vi.spyOn(PulumiCommand, "get").mockResolvedValue({ command: "pulumi" } as PulumiCommand)

  const spawn = vi
    .spyOn(Bun, "spawn")
    .mockReturnValueOnce({
      stderr: Response.json(denial).body,
      exited: Promise.resolve(1),
    } as unknown as ReturnType<typeof Bun.spawn>)
    .mockReturnValueOnce({
      stdout: null,
      stderr: null,
      exited: Promise.resolve(0),
    } as unknown as ReturnType<typeof Bun.spawn>)

  const failure = await probeHostsNamespace(false).catch((error: Error) => error)
  expect(failure).toBeInstanceOf(Error)

  const tracker = new SidecarTracker({
    dockerBinary: "docker",
    dockerUseSudo: false,
    logger: pino({ enabled: false }),
    onUnitLog: () => {},
    unavailableReason: (failure as Error).message,
  })

  const command = (await createForceAbortableCommand({
    hostsFilePath: await tracker.registerExecution("operation", false),
  })) as PulumiCommand & {
    run(args: string[], cwd: string, env: Record<string, string>): Promise<unknown>
  }

  await command.run(["version"], "/tmp", {})
  expect(spawn.mock.calls[1]?.[0]).toEqual(["pulumi", "version", "--non-interactive"])

  await expect(
    tracker.startSidecar(
      "operation",
      "ssh.key-pair.v1:key-pair-1",
      runtimeSidecarStartInputSchema.parse({ identity: "test", image: "example" }),
    ),
  ).rejects.toThrow(denial)

  expect(spawn).toHaveBeenCalledTimes(2)
})
