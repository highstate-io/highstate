import type { HighstateClients } from "../shared/remote"
import { create } from "@bufbuild/protobuf"
import {
  LaunchOperationResponseSchema,
  OperationPhaseType,
  PlanOperationResponseSchema,
} from "@highstate/api/v1"
import { Cli } from "clipanion"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import registerRemoteCommands from "../register-remote-commands"
import * as io from "../shared/remote-io"
import { RemoteCommand } from "./remote"

describe("registered reviewed operations", () => {
  const operation = { planOperation: vi.fn(), launchOperation: vi.fn() }
  let cli: Cli
  let stdout: string
  let stderr: string
  beforeEach(() => {
    cli = new Cli({ binaryName: "highstate" })
    registerRemoteCommands(cli)
    stdout = ""
    stderr = ""
    vi.spyOn(process.stdout, "write").mockImplementation(value => {
      stdout += String(value)
      return true
    })
    vi.spyOn(process.stderr, "write").mockImplementation(value => {
      stderr += String(value)
      return true
    })
    vi.spyOn(RemoteCommand.prototype, "remote").mockResolvedValue({
      clients: { operation } as unknown as HighstateClients,
      target: { apiUrl: "https://example.test", apiToken: "token", projectId: "project-1" },
    })
    operation.planOperation.mockResolvedValue(
      create(PlanOperationResponseSchema, {
        phases: [{ type: OperationPhaseType.DESTROY }],
        plan: {
          token: "opaque-reviewed-token",
          modelRevision: "model-2",
          librarySnapshotId: "snapshot-3",
          localOverlayRevision: "overlay-4",
          phases: [
            {
              type: OperationPhaseType.UPDATE,
              instances: [{ id: "instance-1", message: "Upgrade package" }],
            },
          ],
        },
      }),
    )
    operation.launchOperation.mockResolvedValue(create(LaunchOperationResponseSchema))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    process.exitCode = 0
  })

  it("round trips reviewed token and revisions while submitting no caller phases", async () => {
    await cli.run(["operation", "plan", "update", "instance-1", "--refresh", "--output", "json"])
    const document = JSON.parse(stdout)
    expect(document).toMatchObject({
      plan_token: "opaque-reviewed-token",
      model_revision: "model-2",
      library_snapshot_id: "snapshot-3",
      local_overlay_revision: "overlay-4",
      phases: [{ type: "OPERATION_PHASE_TYPE_UPDATE" }],
    })
    vi.spyOn(io, "readDocument").mockResolvedValue(document)
    await cli.run(["operation", "launch", "--plan", "-", "--title", "Reviewed update"])
    expect(operation.launchOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        planToken: "opaque-reviewed-token",
        options: expect.objectContaining({ refresh: true }),
      }),
    )
    expect(operation.launchOperation.mock.calls[0]![0]).not.toHaveProperty("plan")
    expect(operation.planOperation).toHaveBeenCalledTimes(1)
  })

  it("run forwards the issued token without replanning", async () => {
    await cli.run(["operation", "run", "update", "instance-1", "--yes"])
    expect(operation.planOperation).toHaveBeenCalledTimes(1)
    expect(operation.launchOperation).toHaveBeenCalledWith(
      expect.objectContaining({ planToken: "opaque-reviewed-token" }),
    )
    expect(operation.launchOperation.mock.calls[0]![0]).not.toHaveProperty("plan")
  })

  it("rejects legacy raw-phase documents before launch", async () => {
    vi.spyOn(io, "readDocument").mockResolvedValue({
      format_version: 1,
      project_id: "project-1",
      type: "update",
      instance_ids: ["instance-1"],
      phases: [],
    })
    await cli.run(["operation", "launch", "--plan", "-", "--title", "Update"])
    expect(operation.launchOperation).not.toHaveBeenCalled()
    expect(stderr).toContain("plan_token")
  })

  it("rejects a selected project mismatch", async () => {
    vi.spyOn(io, "readDocument").mockResolvedValue({
      format_version: 1,
      project_id: "other-project",
      type: "update",
      instance_ids: ["instance-1"],
      phases: [],
      plan_token: "token",
      model_revision: "rev",
    })
    await cli.run(["operation", "launch", "--plan", "-", "--title", "Update"])
    expect(operation.launchOperation).not.toHaveBeenCalled()
    expect(stderr).toContain("does not match selected project")
  })

  it("fails closed if the backend returns only legacy phases", async () => {
    operation.planOperation.mockResolvedValue(create(PlanOperationResponseSchema, { phases: [] }))
    await cli.run(["operation", "run", "update", "instance-1", "--yes"])
    expect(operation.launchOperation).not.toHaveBeenCalled()
    expect(stderr).toContain("revision-bound operation plan")
  })
})
