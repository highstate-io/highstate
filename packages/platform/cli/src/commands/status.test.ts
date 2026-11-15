import type { HighstateClients } from "../shared/remote"
import { Cli } from "clipanion"
import { describe, expect, it, vi } from "vitest"
import { collectStatus, formatStatus, StatusCommand } from "./status"

const moduleUrl = import.meta.url

function clients(options: { projectId?: string; locked?: boolean } = {}): HighstateClients {
  const projectId = options.projectId ?? "project-1"

  return {
    project: {
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          {
            project: { id: projectId, name: "project", $typeName: "io.highstate.v1.Project" },
            isLocked: options.locked ?? false,
            $typeName: "io.highstate.v1.ProjectEntry",
          },
        ],
        $typeName: "io.highstate.v1.ListProjectsResponse",
      }),
      getProject: vi.fn().mockResolvedValue({
        project: { id: projectId, name: "project", $typeName: "io.highstate.v1.Project" },
        isLocked: false,
        $typeName: "io.highstate.v1.GetProjectResponse",
      }),
    },
  } as unknown as HighstateClients
}

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    HIGHSTATE_CONFIG_PATH: `/tmp/highstate-agent-status-${crypto.randomUUID()}.json`,
    ...values,
  }
}

describe("status", () => {
  it.each([
    "human",
    "json",
    "yaml",
  ])("supports %s output through the standard printer", async output => {
    vi.stubEnv("HIGHSTATE_CONFIG_PATH", env().HIGHSTATE_CONFIG_PATH)
    vi.stubEnv("HIGHSTATE_API_URL", "")
    vi.stubEnv("HIGHSTATE_CONTEXT", "")
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true)

    try {
      const cli = new Cli()
      cli.register(StatusCommand)
      expect(await cli.run(["status", "--output", output])).toBe(0)
      const text = write.mock.calls.map(([value]) => String(value)).join("")

      if (output === "json") {
        expect(JSON.parse(text).backend.state).toBe("missing")
      } else {
        expect(text.toLowerCase()).toContain("backend:")
        expect(text.toLowerCase()).toContain("state: missing")
      }

      expect(text).toContain("Configure a Highstate context")
    } finally {
      vi.unstubAllEnvs()
      write.mockRestore()
    }
  })

  it("reports missing backend configuration with an actionable instruction", async () => {
    const status = await collectStatus({ moduleUrl, env: env() })

    expect(status.backend.state).toBe("missing")
    expect(status.project.state).toBe("missing")

    expect(status.next_actions).toContain(
      "Configure a Highstate context or provide HIGHSTATE_API_URL.",
    )
  })

  it("reports an unlocked and authorized selected project", async () => {
    const status = await collectStatus({
      moduleUrl,
      env: env({
        HIGHSTATE_API_URL: "http://localhost:3000",
        HIGHSTATE_API_TOKEN: "token",
        HIGHSTATE_PROJECT_ID: "project-1",
      }),
      clients: clients(),
    })

    expect(status.backend.state).toBe("ready")
    expect(status.project.state).toBe("ready")
    expect(status.next_actions).toEqual([])
    expect(formatStatus(status)).not.toContain("Next actions:")
    expect(formatStatus(status)).toContain("State: ready")
    expect(formatStatus(status)).toContain(`CLI version: ${status.cli_version}`)
  })

  it("does not attempt project authentication while a selected project is locked", async () => {
    const mockClients = clients({ locked: true })

    const status = await collectStatus({
      moduleUrl,
      env: env({
        HIGHSTATE_API_URL: "http://localhost:3000",
        HIGHSTATE_API_TOKEN: "token",
        HIGHSTATE_PROJECT_ID: "project-1",
      }),
      clients: mockClients,
    })

    expect(status.project.state).toBe("locked")
    expect(mockClients.project.getProject).not.toHaveBeenCalled()

    expect(status.next_actions).toContain('Unlock project "project-1" in Highstate.')
  })

  it("asks for an explicit project after backend authorization succeeds", async () => {
    const status = await collectStatus({
      moduleUrl,
      env: env({
        HIGHSTATE_API_URL: "http://localhost:3000",
        HIGHSTATE_API_TOKEN: "token",
      }),
      clients: clients(),
    })

    expect(status.backend.state).toBe("ready")
    expect(status.project.state).toBe("missing")
    expect(status.next_actions[0]).toContain("--project <project-id>")
  })
})
