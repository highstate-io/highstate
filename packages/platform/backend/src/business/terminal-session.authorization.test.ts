import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { TerminalSessionService } from "./terminal-session"

describe("TerminalSessionService authorization", () => {
  test("requires terminal.get", async ({ database, project }) => {
    const service = new TerminalSessionService(database)

    await expect(
      service.getInstanceTerminalSessions(createProjectRequestContext(project.id), "missing"),
    ).resolves.toEqual([])

    await expect(
      service.getInstanceTerminalSessions(
        createProjectRequestContext(project.id, grantProjectPermission("terminal.get")),
        "missing",
      ),
    ).resolves.toEqual([])
  })

  test("denies a session from an unrelated instance", async ({
    database,
    project,
    createInstanceState,
    projectDatabase,
  }) => {
    const service = new TerminalSessionService(database)
    const state = await createInstanceState(project.id)
    const terminal = await projectDatabase.terminal.create({
      data: { id: createId(), meta: { title: "Terminal" }, spec: {}, stateId: state.id },
    })
    await projectDatabase.terminalSession.create({
      data: { id: createId(), terminalId: terminal.id },
    })
    const otherState = await createInstanceState(project.id)

    await expect(
      service.getInstanceTerminalSessions(
        createProjectRequestContext(
          project.id,
          grantProjectPermission("terminal.get", [
            { type: "instances", instanceIds: [otherState.instanceId], recursive: false },
          ]),
        ),
        state.id,
      ),
    ).rejects.toThrow(PermissionDeniedError)
  })
})
