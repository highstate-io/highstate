import { readFileSync } from "node:fs"
import { ModuleKind, transpileModule } from "typescript"
import { describe, expect, it, vi } from "vitest"
import * as vue from "vue"
import { compileScript, parse } from "vue/compiler-sfc"

type HostNode = { parent: HostNode | null; children: HostNode[] }

const renderer = vue.createRenderer<HostNode, HostNode>({
  createElement: () => ({ parent: null, children: [] }),
  createText: () => ({ parent: null, children: [] }),
  createComment: () => ({ parent: null, children: [] }),
  setText() {},
  setElementText() {},
  patchProp() {},
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
    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = null
    }
  },
})

function compileComponent(path: string, modules: Record<string, unknown>, globals = {}) {
  const filename = new URL(path, import.meta.url)
  const { descriptor } = parse(readFileSync(filename, "utf8"), { filename: filename.pathname })

  const script = compileScript(descriptor, {
    id: "lazy-overlay-test",
    genDefaultAs: "component",
    inlineTemplate: true,
  })

  const compiled = transpileModule(script.content, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText

  const injections = { ...vue, ...globals }

  return new Function(
    "require",
    ...Object.keys(injections),
    `const exports = {};\n${compiled}\nreturn component`,
  )(
    (id: string) => {
      if (id === "vue") {
        return vue
      }

      if (!(id in modules)) {
        throw new Error(`Unexpected SFC dependency: ${id}`)
      }

      return id.endsWith(".vue") ? { default: modules[id] } : modules[id]
    },
    ...Object.values(injections),
  ) as vue.Component
}

function registerPassiveComponents(app: vue.App) {
  const component = vue.defineComponent({ setup: () => () => vue.h("passive") })

  for (const name of [
    "VListItemTitle",
    "VListItemSubtitle",
    "VListItem",
    "VList",
    "VIcon",
    "VTextField",
    "VTextarea",
    "VCol",
    "VAlert",
    "VRow",
    "VContainer",
    "VCardText",
    "VSpacer",
    "VBtn",
    "VCardActions",
    "VCard",
  ]) {
    app.component(name, component)
  }
}

function descendants(
  instance: vue.ComponentInternalInstance | null,
): vue.ComponentInternalInstance[] {
  const result: vue.ComponentInternalInstance[] = []

  const visit = (vnode: vue.VNode) => {
    if (vnode.component) {
      result.push(vnode.component)
      visit(vnode.component.subTree)
    }

    if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        if (vue.isVNode(child)) {
          visit(child)
        }
      }
    }
  }

  if (instance) {
    visit(instance.subTree)
  }

  return result
}

describe("lazy canvas overlays", () => {
  it("allocates a context menu only on first use, reuses it, and removes its outside listener", async () => {
    const events = new EventTarget()
    const add = vi.spyOn(events, "addEventListener")
    const remove = vi.spyOn(events, "removeEventListener")
    vi.stubGlobal("window", events)
    const mounted = vi.fn()

    const Menu = vue.defineComponent({
      name: "MenuProbe",
      props: ["modelValue", "target"],
      setup() {
        mounted()
        return () => vue.h("menu")
      },
    })

    const ContextMenu = compileComponent("./GenericContextMenu.vue", {
      "./InlineCopyButton.vue": {},
    })

    const visible = vue.ref(false)
    const menu = vue.shallowRef<{ showContextMenu: (event: MouseEvent) => Promise<void> }>()

    const app = renderer.createApp({
      setup: () => () =>
        vue.h(ContextMenu, {
          ref: menu,
          visible: visible.value,
          "onUpdate:visible": (value: boolean) => {
            visible.value = value
          },
          title: "Test",
          subtitle: "test",
        }),
    })

    app.component("VMenu", Menu)
    registerPassiveComponents(app)
    app.mount({ parent: null, children: [] })

    try {
      expect(mounted).not.toHaveBeenCalled()
      const preventDefault = vi.fn()

      await menu.value?.showContextMenu({
        clientX: 12,
        clientY: 34,
        preventDefault,
      } as unknown as MouseEvent)

      await vue.nextTick()
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(mounted).toHaveBeenCalledOnce()
      let overlay = descendants(app._instance).find(child => child.type === Menu)
      expect(overlay?.props).toMatchObject({ modelValue: true, target: [12, 34] })
      visible.value = false
      await vue.nextTick()

      await menu.value?.showContextMenu({
        clientX: 56,
        clientY: 78,
        preventDefault,
      } as unknown as MouseEvent)

      await vue.nextTick()
      overlay = descendants(app._instance).find(child => child.type === Menu)
      expect(overlay?.props).toMatchObject({ modelValue: true, target: [56, 78] })
      expect(mounted).toHaveBeenCalledOnce()
      expect(add).toHaveBeenCalledTimes(2)
    } finally {
      app.unmount()
      vi.unstubAllGlobals()
    }

    expect(remove).toHaveBeenCalledTimes(2)
  })

  it("does not mount per-node dialogs until requested and plans the first lazy operation exactly once", async () => {
    const selected = [
      { id: "one", kind: "unit", name: "One" },
      { id: "two", kind: "unit", name: "Two" },
    ]

    const selection = { selectedInstances: selected, clearSelection: vi.fn() }
    const planOperation = vi.fn(async () => [])

    const stores = {
      projectStore: { projectId: "test" },
      stateStore: { instanceStates: new Map(), isNodeDeletable: () => false },
      operationsStore: { planOperation },
    }

    const globals = {
      useProjectStores: () => stores,
      useWorkspaceStore: () => ({}),
      useCanvasStore: () => ({ selection }),
      generateMultipleInstancesOperationTitle: () => "Test operation",
      generateOperationTitle: () => "Test operation",
    }

    const OperationDialog = compileComponent(
      "../../instance-context-menu/components/InstanceOperationDialog.vue",
      {
        "#layers/core/app/features/instance-context-menu": { getVisibleOperationOptions: () => [] },
        "#layers/core/app/features/shared": {},
        "./OperationOptions.vue": {},
        "./OperationPlanTree.vue": {},
      },
      globals,
    )

    const ForgetDialog = vue.defineComponent({
      name: "ForgetProbe",
      props: ["visible", "instances"],
      setup: () => () => vue.h("forget"),
    })

    const ContextItem = vue.defineComponent({ props: ["title"], setup: () => () => vue.h("item") })

    const NodeMenu = vue.defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          vue.h("menu", slots.default?.()),
    })

    const ContextMenu = compileComponent(
      "../../instance-context-menu/components/InstanceContextMenu.vue",
      {
        "@highstate/backend/shared": {
          isInstanceDeployed: () => true,
          isTransientInstanceOperationStatus: () => false,
        },
        "#layers/core/app/features/shared": {
          ContextMenuItem: ContextItem,
          NodeContextMenu: NodeMenu,
        },
        "./InstanceOperationDialog.vue": OperationDialog,
        "./ForgetInstanceStateDialog.vue": ForgetDialog,
        "./PageListSubmenu.vue": {},
        "./PanelListSubmenu.vue": {},
        "./TerminalListSubmenu.vue": {},
      },
      globals,
    )

    const app = renderer.createApp(ContextMenu, {
      instance: selected[0],
      stores,
      component: { meta: { title: "Test" } },
    })

    app.component("VDialog", vue.defineComponent({ setup: () => () => vue.h("dialog") }))
    app.component("VDivider", vue.defineComponent({ setup: () => () => vue.h("divider") }))
    registerPassiveComponents(app)
    app.mount({ parent: null, children: [] })
    const children = () => descendants(app._instance)

    const clickItem = (title: string) => {
      const item = children().find(
        child => child.type === ContextItem && child.props.title === title,
      )

      expect(item).toBeDefined()
      item?.emit("click")
    }

    try {
      expect(
        children().some(child => child.type === OperationDialog || child.type === ForgetDialog),
      ).toBe(false)

      expect(planOperation).not.toHaveBeenCalled()
      clickItem("Update selected (2)")
      await vue.nextTick()
      expect(planOperation).toHaveBeenCalledOnce()

      expect(planOperation).toHaveBeenLastCalledWith(
        expect.objectContaining({ instanceIds: ["one", "two"], type: "update" }),
      )

      const dialog = children().find(child => child.type === OperationDialog)
      expect(dialog?.props.visible).toBe(true)
      expect(selection.clearSelection).toHaveBeenCalledOnce()
      dialog?.emit("update:visible", false)
      await vue.nextTick()
      clickItem("Update selected (2)")
      await vue.nextTick()
      expect(children().find(child => child.type === OperationDialog)).toBe(dialog)
      expect(planOperation).toHaveBeenCalledTimes(2)
      clickItem("Forget State selected (2)")
      await vue.nextTick()

      expect(children().find(child => child.type === ForgetDialog)?.props.instances).toEqual(
        selected,
      )
    } finally {
      app.unmount()
    }
  })
})
