import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { ActionProcesses } from "./processes"

const fixture = fileURLToPath(new URL("./processes.fixture.ts", import.meta.url))
const managers: ActionProcesses[] = []
afterEach(() => {
  for (const manager of managers.splice(0)) {
    manager.stop()
  }
})

describe("ActionProcesses", () => {
  test("waits for the complete output stream and its delivery before settling an exited action", async () => {
    const manager = new ActionProcesses()
    managers.push(manager)
    let received = 0

    await manager.start(
      "complete",
      fixture,
      { complete: true },
      async () => {},
      async data => {
        await new Promise(resolve => setTimeout(resolve, 10))
        received += data.length
      },
    )

    expect(received).toBe(256 * 1024)
    expect(manager.cancel("complete", true)).toBe(false)
  })

  test("normal cancellation interrupts the complete action group while its sibling keeps serving requests", async () => {
    const manager = new ActionProcesses()
    managers.push(manager)
    let firstOutput = ""
    let secondOutput = ""
    const firstReady = Promise.withResolvers<void>()
    const secondReady = Promise.withResolvers<void>()
    const pong = Promise.withResolvers<void>()

    const first = manager.start(
      "first",
      fixture,
      {},
      async () => {},
      async data => {
        firstOutput += data.toString()

        if (firstOutput.includes("child-ready")) {
          firstReady.resolve()
        }
      },
    )

    const second = manager.start(
      "second",
      fixture,
      {},
      async event => {
        if ((event as { pong?: boolean }).pong) {
          pong.resolve()
        }
      },
      async data => {
        secondOutput += data.toString()

        if (secondOutput.includes("child-ready")) {
          secondReady.resolve()
        }
      },
    )

    void first.catch(() => {})
    void second.catch(() => {})
    await Promise.all([firstReady.promise, secondReady.promise])
    expect(manager.cancel("first", false)).toBe(true)
    await first
    expect(firstOutput).toContain("child-interrupted")
    manager.respond("second", { ping: true })
    await pong.promise
    expect(manager.cancel("first", true)).toBe(false)
    manager.cancel("second", true)
    await expect(second).rejects.toThrow("SIGKILL")
  })

  test("force cancellation terminates an action that ignores normal cancellation without killing its sibling", async () => {
    const manager = new ActionProcesses()
    managers.push(manager)
    const ready = Promise.withResolvers<void>()
    const ignored = Promise.withResolvers<void>()
    const pong = Promise.withResolvers<void>()
    let output = ""

    const first = manager.start(
      "first",
      fixture,
      { ignoreInterrupt: true },
      async event => {
        if ((event as { ignored?: boolean }).ignored) {
          ignored.resolve()
        }
      },
      async data => {
        output += data.toString()

        if (output.includes("child-ready")) {
          ready.resolve()
        }
      },
    )

    const second = manager.start(
      "second",
      fixture,
      {},
      async event => {
        if ((event as { pong?: boolean }).pong) {
          pong.resolve()
        }
      },
      async () => {},
    )

    void first.catch(() => {})
    void second.catch(() => {})
    await ready.promise
    manager.cancel("first", false)
    await ignored.promise
    manager.cancel("first", true)
    await expect(first).rejects.toThrow("SIGKILL")
    manager.respond("second", { ping: true })
    await pong.promise
    manager.cancel("second", true)
    await expect(second).rejects.toThrow("SIGKILL")
  })

  test("normal cancellation settles when the descendant exits before its parent handles the interrupt", async () => {
    const manager = new ActionProcesses()
    managers.push(manager)
    const ready = Promise.withResolvers<void>()
    const childExited = Promise.withResolvers<void>()
    let output = ""

    const action = manager.start(
      "child-first",
      fixture,
      {},
      async event => {
        if ((event as { childExited?: boolean }).childExited) {
          childExited.resolve()
        }
      },
      async data => {
        output += data.toString()

        if (output.includes("child-ready")) {
          ready.resolve()
        }
      },
    )

    void action.catch(() => {})
    await ready.promise
    manager.respond("child-first", { interruptChild: true })
    await childExited.promise
    expect(manager.cancel("child-first", false)).toBe(true)
    await action
    expect(manager.cancel("child-first", true)).toBe(false)
  })
})
