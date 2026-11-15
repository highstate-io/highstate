import type { RuntimeDomainHandler } from "../container-runtime/coordinator"
import { expect, test, vi } from "vitest"
import { RuntimeRunnerBackend } from "./runtime"

test.each([
  0, 1,
])("tracks state deletion without persisted action ownership (exit %s)", async exitCode => {
  let handler: RuntimeDomainHandler | undefined
  const completed = { type: "completed" as const, actionId: "action", exitCode }
  const cleanup = vi.fn(async () => {})
  const createAction = vi.fn(async () => ({ id: "action" }))

  const coordinator = {
    registerHandler: (_kind: string, value: RuntimeDomainHandler) => {
      handler = value
    },
    createAction,
    dispatch: async () => {
      await expect(handler!.event({} as never, completed)).resolves.toBeUndefined()
    },
    waitForAction: async () => completed,
    requestCleanup: cleanup,
  }

  const runner = new RuntimeRunnerBackend(
    {
      forProject: async () => ({
        instanceState: { findUnique: async () => ({ librarySnapshotId: "snapshot" }) },
      }),
    } as never,
    {
      start: async () => ({ workload: { id: "workload" } }),
      coordinator,
    } as never,
    {} as never,
    { get: async () => ({ url: "file://~", environment: {} }) } as never,
    {} as never,
    {} as never,
    {} as never,
  )

  const deletion = runner.deleteState({
    projectId: "project",
    stateId: "state",
    libraryId: "library",
      instanceType: "example.Component.v1",
    instanceName: "example",
  })

  if (exitCode === 0) {
    await expect(deletion).resolves.toBeUndefined()
  } else {
    await expect(deletion).rejects.toThrow("State deletion failed")
  }

  expect(createAction).toHaveBeenCalledWith({
    workloadId: "workload",
    kind: "pulumi",
    snapshotId: "snapshot",
  })

  expect(cleanup).toHaveBeenCalledWith("workload")
  await expect(handler!.event({} as never, completed)).rejects.toThrow("Unknown runner action")
})
