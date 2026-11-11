import { effectScope, type Ref, watch } from "vue"

interface HoverColumn {
  enter: () => void
  leave: () => void
}

interface TouchHoverCoordinator {
  register: (element: HTMLElement, column: HoverColumn) => () => void
}

const coordinators = new WeakMap<Ref<unknown>, TouchHoverCoordinator>()

function createCoordinator(connection: Ref<unknown>, document: Document): TouchHoverCoordinator {
  const columns = new Map<Element, HoverColumn>()
  const scope = effectScope(true)
  let hovered: HoverColumn | undefined

  const clearHover = () => {
    hovered?.leave()
    hovered = undefined
  }

  const move = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      clearHover()
      return
    }

    const touch = event.touches[0]

    const element = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest("[data-instance-io-column]")

    const column = element ? columns.get(element) : undefined
    if (column !== hovered) {
      clearHover()
      hovered = column
    }

    hovered?.enter()
  }

  const detach = () => {
    document.removeEventListener("touchmove", move, true)
    document.removeEventListener("touchend", end, true)
    document.removeEventListener("touchcancel", detach, true)
    clearHover()
  }

  const end = (event: TouchEvent) => {
    if (event.touches.length === 0) {
      detach()
    }
  }

  scope.run(() => {
    watch(
      connection,
      active => {
        detach()

        if (active) {
          // capture runs before Vue Flow's connection listener, even with implicit touch pointer capture
          document.addEventListener("touchmove", move, { capture: true, passive: true })
          document.addEventListener("touchend", end, { capture: true, passive: true })
          document.addEventListener("touchcancel", detach, { capture: true, passive: true })
        }
      },
      { immediate: true, flush: "sync" },
    )
  })

  return {
    register(element, column) {
      columns.set(element, column)

      return () => {
        if (hovered === column) {
          clearHover()
        }

        columns.delete(element)

        if (columns.size === 0) {
          scope.stop()
          detach()
          coordinators.delete(connection)
        }
      }
    },
  }
}

export function useTouchConnectionHover(
  connection: Ref<unknown>,
  element: Readonly<Ref<HTMLElement | null>>,
  enter: () => void,
  leave: () => void,
) {
  watch(
    element,
    (element, _, onCleanup) => {
      if (!element) {
        return
      }

      let coordinator = coordinators.get(connection)
      if (!coordinator) {
        coordinator = createCoordinator(connection, element.ownerDocument)
        coordinators.set(connection, coordinator)
      }

      onCleanup(coordinator.register(element, { enter, leave }))
    },
    { immediate: true, flush: "post" },
  )
}
