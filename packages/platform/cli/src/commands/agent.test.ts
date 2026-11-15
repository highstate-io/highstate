import { Cli } from "clipanion"
import { afterEach, expect, it, vi } from "vitest"
import { AgentInstructionsCommand, formatAgentInstructions } from "./agent"
import { StatusCommand } from "./status"

afterEach(() => vi.restoreAllMocks())

it("prints instructions without inspecting configuration or contacting a backend", async () => {
  vi.stubEnv("HIGHSTATE_CONFIG_PATH", "/dev/null/invalid-config.json")
  vi.stubEnv("HIGHSTATE_API_URL", "not-a-url")
  const fetch = vi.spyOn(globalThis, "fetch")
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true)

  try {
    const cli = new Cli()
    cli.register(AgentInstructionsCommand)
    expect(await cli.run(["agent", "instructions"])).toBe(0)
    expect(write).toHaveBeenCalledWith(formatAgentInstructions())
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
  }
})

it("resolves status outside the agent namespace with explicit project selection", () => {
  const cli = new Cli()
  cli.register(StatusCommand)
  const command = cli.process(["status", "--project", "project-1"])
  expect(command).toBeInstanceOf(StatusCommand)
  expect((command as StatusCommand).projectId).toBe("project-1")
  expect(() => cli.process(["agent", "status"])).toThrow()
})
