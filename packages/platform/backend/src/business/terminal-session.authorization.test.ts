import { createId } from "@paralleldrive/cuid2"
import { describe, expect } from "vitest"
import { PermissionDeniedError } from "../shared"
import { createProjectRequestContext, grantProjectPermission, test } from "../test-utils"
import { TerminalSessionService } from "./terminal-session"

describe("TerminalSessionService authorization", () => {
  test("filters terminal collections and authorizes connections with recursive and resource grants", async ({
    database,
    project,
    projectDatabase,
    createInstanceState,
  }) => {
    const service = new TerminalSessionService(database)
    const parent = await createInstanceState(project.id)
    const child = await createInstanceState(project.id)
    const unrelated = await createInstanceState(project.id)

    await projectDatabase.instanceState.update({
      where: { id: child.id },
      data: { parentId: parent.id },
    })

    const terminals = await Promise.all(
      [child, unrelated].map(state =>
        projectDatabase.terminal.create({
          data: { meta: { title: "Terminal" }, spec: {}, stateId: state.id },
        }),
      ),
    )

    const [allowed, denied] = terminals

    const read = createProjectRequestContext(
      project.id,
      grantProjectPermission("terminal.get", [
        { type: "instances", instanceIds: [parent.instanceId], recursive: true },
      ]),
    )

    expect(
      (
        await service.getTerminals(
          read,
          terminals.map(terminal => terminal.id),
        )
      ).map(terminal => terminal.id),
    ).toEqual([allowed.id])

    const session = await projectDatabase.terminalSession.create({
      data: { terminalId: allowed.id },
    })

    await expect(service.getTerminalSession(read, session.id)).resolves.toMatchObject({
      id: session.id,
    })

    const connect = createProjectRequestContext(
      project.id,
      grantProjectPermission("terminal.connect", [
        { type: "resources", resourceIds: [allowed.id] },
      ]),
    )

    await expect(service.authorizeConnection(connect, allowed.id)).resolves.toBeUndefined()

    await expect(service.authorizeConnection(connect, denied.id)).rejects.toThrow(
      PermissionDeniedError,
    )

    await expect(service.authorizeConnection(read, allowed.id)).rejects.toThrow(
      PermissionDeniedError,
    )

    await expect(
      service.getTerminalSession(
        createProjectRequestContext("other-project", grantProjectPermission("terminal.get")),
        session.id,
      ),
    ).resolves.toBeNull()
  })

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
    ).resolves.toEqual([])
  })
})
