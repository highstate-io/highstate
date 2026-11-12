import { readFileSync } from "node:fs"
import { ModuleKind, transpileModule } from "typescript"
import { describe, expect, test, vi } from "vitest"
import * as vue from "vue"
import { compileScript, parse } from "vue/compiler-sfc"

class HostElement extends EventTarget {
  parent: HostElement | null = null
  children: HostElement[] = []
  props: Record<string, unknown> & { onKeydown?: (event: KeyEvent) => void } = {}
  connected = true

  constructor(readonly tag = "host") {
    super()
  }

  get isConnected() {
    return this.connected
  }

  matches() {
    return true
  }
}
class KeyEvent extends Event {
  readonly key: string

  constructor(typeOrKey: string, init?: { key?: string }) {
    super("keydown", { cancelable: true })
    this.key = init?.key ?? typeOrKey
  }
}
const renderer = vue.createRenderer<HostElement, HostElement>({
  createElement: tag => new HostElement(tag),
  createText: () => new HostElement(),
  createComment: () => new HostElement(),
  setText() {},
  setElementText() {},
  patchProp(node, key, _previous, value) {
    node.props[key] = value
  },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
    }

    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
  },
  remove(node) {
    node.connected = false

    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
    }

    node.parent = null
  },
})
function compile(path: string, modules: Record<string, unknown> = {}, globals = {}) {
  const filename = new URL(path, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, "utf8"), { filename: filename.pathname })

  const script = compileScript(descriptor, {
    id: "lazy-menu-test",
    genDefaultAs: "component",
    inlineTemplate: true,
  })

  const compiled = transpileModule(script.content, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText

  const injections = { ...vue, Element: HostElement, KeyboardEvent: KeyEvent, ...globals }
  return new Function(
    "require",
    ...Object.keys(injections),
    `const exports={};\n${compiled}\nreturn component`,
  )(
    (id: string) => {
      if (id === "vue") {
        return vue
      }

      if (!(id in modules)) {
        throw Error(`Unexpected menu dependency: ${id}`)
      }

      return modules[id]
    },
    ...Object.values(injections),
  ) as vue.Component
}
const ticks = async () => {
  await vue.nextTick()
  await vue.nextTick()
  await vue.nextTick()
}

function menuHarness() {
  const visible = vue.ref(false),
    disabled = vue.ref(false),
    mounts = vi.fn(),
    delegated = vi.fn()

  let latest: Readonly<{ id?: string; activator: HostElement; modelValue: boolean }>
  let enter: () => void

  const Menu = vue.defineComponent({
    props: {
      id: String,
      activator: { type: Object as vue.PropType<HostElement>, required: true },
      modelValue: Boolean,
    },
    emits: ["afterEnter"],
    setup(props, { expose, emit }) {
      mounts()
      latest = props
      enter = () => emit("afterEnter")

      expose({
        get activatorEl() {
          return props.activator
        },
      })

      vue.onMounted(() => props.activator.addEventListener("keydown", delegated))
      vue.onBeforeUnmount(() => props.activator.removeEventListener("keydown", delegated))
      return () => vue.h("menu")
    },
  })

  const document = { activeElement: undefined as HostElement | undefined }
  const LazyMenu = compile("./LazyMenu.vue", {}, { document })

  const app = renderer.createApp({
    setup: () => () =>
      vue.h(
        LazyMenu,
        {
          modelValue: visible.value,
          disabled: disabled.value,
          "onUpdate:modelValue": (value: boolean) => {
            visible.value = value
          },
        },
        { activator: ({ props }: { props: Record<string, unknown> }) => vue.h("button", props) },
      ),
  })

  app.component("VMenu", Menu)
  const root = new HostElement("root")
  app.mount(root)
  const button = () => root.children.find(node => node.tag === "button")!
  document.activeElement = button()
  return {
    app,
    root,
    visible,
    disabled,
    mounts,
    delegated,
    button,
    latest: () => latest,
    enter: () => enter(),
    blur: () => {
      document.activeElement = undefined
    },
  }
}

describe("lazy menu activators", () => {
  test("keeps the same activator and creates one reusable menu only after opening", async () => {
    const h = menuHarness()

    try {
      const button = h.button()
      expect(h.mounts).not.toHaveBeenCalled()
      expect(button.props["aria-expanded"]).toBe("false")
      h.visible.value = true
      await ticks()
      expect(h.mounts).toHaveBeenCalledOnce()
      expect(h.button()).toBe(button)
      expect(h.latest().activator).toBe(button)
      expect(h.latest().id).toBe(button.props["aria-controls"])
      expect(button.props["aria-expanded"]).toBe("true")
      h.visible.value = false
      await ticks()
      h.visible.value = true
      await ticks()
      expect(h.mounts).toHaveBeenCalledOnce()
    } finally {
      h.app.unmount()
    }
  })

  test("ignores disabled and unrelated keys, then delegates the first arrow key once", async () => {
    const h = menuHarness()

    try {
      h.disabled.value = true
      await ticks()
      h.button().props.onKeydown!(new KeyEvent("ArrowDown"))
      expect(h.mounts).not.toHaveBeenCalled()
      h.disabled.value = false
      await ticks()
      h.button().props.onKeydown!(new KeyEvent("Enter"))
      expect(h.mounts).not.toHaveBeenCalled()
      const event = new KeyEvent("ArrowDown")
      h.button().props.onKeydown!(event)
      await ticks()
      expect(event.defaultPrevented).toBe(true)
      expect(h.mounts).toHaveBeenCalledOnce()
      expect(h.delegated).not.toHaveBeenCalled()
      h.enter()
      expect(h.delegated).toHaveBeenCalledOnce()
      expect(h.delegated.mock.calls[0][0].key).toBe("ArrowDown")
    } finally {
      h.app.unmount()
    }
  })

  test("does not replay a pending activation after its canvas is unmounted", async () => {
    const h = menuHarness()
    const events = vi.fn()
    const button = h.button()
    button.addEventListener("keydown", events)
    button.props.onKeydown!(new KeyEvent("ArrowDown"))
    h.app.unmount()
    await ticks()
    expect(events).not.toHaveBeenCalled()
  })

  test("cancels the pending first keyboard focus when closed before entering", async () => {
    const h = menuHarness()

    try {
      h.button().props.onKeydown!(new KeyEvent("ArrowDown"))
      await ticks()
      expect(h.visible.value).toBe(true)
      h.visible.value = false
      await ticks()
      h.enter()
      expect(h.delegated).not.toHaveBeenCalled()
    } finally {
      h.app.unmount()
    }
  })

  test("does not steal focus back if the user leaves while the first menu is entering", async () => {
    const h = menuHarness()

    try {
      h.button().props.onKeydown!(new KeyEvent("ArrowDown"))
      await ticks()
      h.blur()
      h.enter()
      expect(h.delegated).not.toHaveBeenCalled()
    } finally {
      h.app.unmount()
    }
  })
})

test("entity popups subscribe globally only while open and release subscriptions on close/unmount", async () => {
  const events = new EventTarget(),
    add = vi.spyOn(events, "addEventListener"),
    remove = vi.spyOn(events, "removeEventListener")

  const unsubscribe = vi.fn(),
    subscribe = vi.fn((_listener: (action: { kind: string }) => void) => unsubscribe),
    load = vi.fn(async () => [])

  const Popup = compile(
    "../../entity-explorer/components/ReferencedEntitiesPopup.vue",
    {
      "#layers/core/app/features/entity-explorer": {
        getEntityOverrideMetaFromContent: vi.fn(),
        resolveEntityDisplay: vi.fn(),
      },
      "#layers/core/app/features/shared": {
        ComponentIcon: {},
        LazyMenu: vue.defineComponent({
          props: ["modelValue"],
          setup:
            (_, { slots }) =>
            () =>
              vue.h("div", slots.activator?.({ props: {} })),
        }),
      },
      "#layers/core/app/utils/monaco": { onHighstateActionInvoked: subscribe },
    },
    { window: events },
  )

  interface ActivatorProps {
    onContextmenu: (event: Pick<MouseEvent, "preventDefault" | "stopPropagation">) => void
  }
  let activatorProps: ActivatorProps
  let opened = false

  const app = renderer.createApp({
    setup: () => () =>
      vue.h(
        Popup,
        {
          canLoad: true,
          cacheKey: "fixture",
          entities: {},
          load,
        },
        {
          activator: (slot: { props: ActivatorProps; opened: boolean }) => {
            activatorProps = slot.props
            opened = slot.opened
            return vue.h("button")
          },
        },
      ),
  })

  for (const name of [
    "VAlert",
    "VTab",
    "VTabs",
    "VDivider",
    "VTabsWindowItem",
    "VTabsWindow",
    "VSheet",
  ]) {
    app.component(name, vue.defineComponent({ setup: () => () => vue.h("passive") }))
  }

  app.mount(new HostElement("root"))

  try {
    expect(add).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    activatorProps!.onContextmenu(event)
    await ticks()
    expect(opened).toBe(true)
    expect(load).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledOnce()
    subscribe.mock.calls[0][0]({ kind: "openEntitySnapshot" })
    await ticks()
    expect(opened).toBe(false)
    expect(remove).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    activatorProps!.onContextmenu(event)
    await ticks()
    expect(add).toHaveBeenCalledTimes(2)
  } finally {
    app.unmount()
  }

  expect(remove).toHaveBeenCalledTimes(2)
  expect(unsubscribe).toHaveBeenCalledTimes(2)
})
