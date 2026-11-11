import { describe, expect, it, vi } from "vitest"
import { effectScope, nextTick, shallowRef } from "vue"
import { useTouchConnectionHover } from "./touch-connection-hover"

function fixture() {
  const document = Object.assign(new EventTarget(), {
    elementFromPoint: vi.fn<(x: number, y: number) => Element | null>(() => null),
  })

  const add = vi.spyOn(document, "addEventListener")
  const connection = shallowRef<unknown>(null)

  const column = (canvasConnection = connection) => {
    const element = { ownerDocument: document } as unknown as HTMLElement
    const enter = vi.fn()
    const leave = vi.fn()
    const scope = effectScope()
    const target = shallowRef<HTMLElement | null>(element)

    scope.run(() => useTouchConnectionHover(canvasConnection, target, enter, leave))

    return { element, target, enter, leave, scope }
  }

  const hit = (element: HTMLElement | null) => {
    document.elementFromPoint.mockReturnValue(
      element ? ({ closest: () => element } as unknown as Element) : null,
    )
  }

  const dispatch = (type = "touchmove", touches = [{ clientX: 100, clientY: 200 }]) => {
    document.dispatchEvent(Object.assign(new Event(type), { touches }))
  }

  return { document, add, connection, column, hit, dispatch }
}

describe("touch connection hover", () => {
  it("shares one gesture-scoped listener across all columns and performs one hit-test per move", () => {
    const { document, add, connection, column, hit, dispatch } = fixture()
    const columns = Array.from({ length: 100 }, () => column())

    hit(columns[99].element)
    dispatch()
    expect(document.elementFromPoint).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()

    connection.value = { nodeId: "source" }
    expect(add.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1)
    dispatch()
    expect(document.elementFromPoint).toHaveBeenCalledExactlyOnceWith(100, 200)
    expect(columns[99].enter).toHaveBeenCalledOnce()
    expect(columns[0].enter).not.toHaveBeenCalled()

    for (const column of columns) {
      column.scope.stop()
    }
  })

  it("uses the hit-tested descendant rather than the captured event target and clears the previous column", () => {
    const { document, connection, column, hit, dispatch } = fixture()
    const source = column()
    const target = column()

    connection.value = { nodeId: "source" }
    hit(target.element)

    const capturedMove = Object.assign(new Event("touchmove"), {
      touches: [{ clientX: 300, clientY: 400 }],
    })

    Object.defineProperty(capturedMove, "target", { value: source.element })
    document.dispatchEvent(capturedMove)
    expect(target.enter).toHaveBeenCalledOnce()
    expect(source.enter).not.toHaveBeenCalled()

    hit(source.element)
    dispatch()
    expect(target.leave).toHaveBeenCalledOnce()
    expect(source.enter).toHaveBeenCalledOnce()
    hit(null)
    dispatch()
    expect(source.leave).toHaveBeenCalledOnce()

    source.scope.stop()
    target.scope.stop()
  })

  it.each([
    "touchend",
    "touchcancel",
    "connection end",
  ])("clears hover and stops tracking on %s", ending => {
    const { document, connection, column, hit, dispatch } = fixture()
    const target = column()

    connection.value = { nodeId: "source" }
    hit(target.element)
    dispatch()

    if (ending === "connection end") {
      connection.value = null
    } else {
      dispatch(ending, [])
    }

    expect(target.leave).toHaveBeenCalledOnce()
    document.elementFromPoint.mockClear()
    dispatch()
    expect(document.elementFromPoint).not.toHaveBeenCalled()

    connection.value = { nodeId: "next-source" }
    dispatch()
    expect(target.enter).toHaveBeenCalledTimes(2)
    target.scope.stop()
  })

  it("ignores columns belonging to another canvas", () => {
    const { connection, column, hit, dispatch } = fixture()
    const source = column()
    const other = column(shallowRef<unknown>(null))

    connection.value = { nodeId: "source" }
    hit(other.element)
    dispatch()
    expect(other.enter).not.toHaveBeenCalled()
    expect(source.enter).not.toHaveBeenCalled()

    source.scope.stop()
    other.scope.stop()
  })

  it("survives disposal of its first column and detaches after its last column is removed", async () => {
    const { document, connection, column, hit, dispatch } = fixture()
    const first = column()
    const second = column()

    connection.value = { nodeId: "source" }
    first.scope.stop()
    hit(second.element)
    dispatch()
    expect(second.enter).toHaveBeenCalledOnce()

    second.target.value = null
    await nextTick()
    expect(second.leave).toHaveBeenCalledOnce()
    document.elementFromPoint.mockClear()
    dispatch()
    expect(document.elementFromPoint).not.toHaveBeenCalled()

    const replacement = column()

    hit(replacement.element)
    dispatch()
    expect(replacement.enter).toHaveBeenCalledOnce()
    replacement.scope.stop()
    second.scope.stop()
  })

  it("clears hover during multitouch without hit-testing and resumes after the extra touch ends", () => {
    const { document, connection, column, hit, dispatch } = fixture()
    const target = column()

    connection.value = { nodeId: "source" }
    hit(target.element)
    dispatch()
    document.elementFromPoint.mockClear()

    dispatch("touchmove", [
      { clientX: 0, clientY: 0 },
      { clientX: 100, clientY: 200 },
    ])

    expect(target.leave).toHaveBeenCalledOnce()
    expect(document.elementFromPoint).not.toHaveBeenCalled()
    dispatch("touchend")
    dispatch()
    expect(target.enter).toHaveBeenCalledTimes(2)

    target.scope.stop()
  })
})
