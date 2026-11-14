import { readFileSync } from "node:fs"
import { ModuleKind, transpileModule } from "typescript"
import { describe, expect, it } from "vitest"
import * as vue from "vue"
import { computed, customRef, effectScope, nextTick, type Ref, reactive, ref, watch } from "vue"
import { compileScript, parse } from "vue/compiler-sfc"
import { useTouchConnectionHover } from "../business/touch-connection-hover"

// exercise the actual SFC setup without introducing a browser environment or a Nuxt test runner
const filename = new URL("./InstanceNodeIOSide.vue", import.meta.url)
const { descriptor } = parse(readFileSync(filename, "utf8"), { filename: filename.pathname })
const script = compileScript(descriptor, { id: "io-side-test", genDefaultAs: "component" })
const compiled = transpileModule(script.content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText

function setupSide() {
  let viewportReads = 0
  let viewportValue = { x: 0, y: 0, zoom: 1 }

  const viewport = customRef((track, trigger) => ({
    get() {
      track()
      viewportReads++
      return viewportValue
    },
    set(value) {
      viewportValue = value
      trigger()
    },
  }))

  const store = { viewport, paneDragging: ref(false), connectionStartHandle: ref<unknown>(null) }

  const modules: Record<string, unknown> = {
    vue,
    "@vue-flow/core": { useVueFlow: () => store },
    "@highstate/backend/shared": { SYSTEM_EXPORT_COMPONENT_TYPE: "system/export" },
    "@highstate/contract": {},
    "#layers/core/app/features/entity-explorer": {},
    "#layers/core/app/utils/vue-flow": {},
    "./InstanceNodeEditableInputChip.vue": {},
    "./InstanceNodeIOSideHandle.vue": {},
    "../business/touch-connection-hover": { useTouchConnectionHover },
  }

  const component = new Function(
    "require",
    "computed",
    "ref",
    "watch",
    "useTemplateRef",
    `const exports = {};\n${compiled}\nreturn component`,
  )(
    (id: string) => {
      if (!(id in modules)) {
        throw new Error(`Unexpected SFC dependency: ${id}`)
      }

      return modules[id]
    },
    computed,
    ref,
    watch,
    () => vue.shallowRef(null),
  )

  const props = reactive({
    instance: { type: "test", inputs: { connected: [{}] } },
    component: {
      inputs: {
        optional: { required: false },
        required: { required: true },
        connected: { required: false },
      },
      outputs: { used: {}, unused: {} },
    },
    entities: {},
    type: "outputs",
    side: "right",
    usedOutputs: new Set(["used"]),
    forceShowAllHandles: false,
    preventShowAllHandles: false,
  })

  const scope = effectScope()

  const side = scope.run(() => component.setup(props, { expose() {} })) as {
    isHovered: Ref<boolean>
    showHandlesOnHover: Ref<boolean>
    shouldShowHandle: (name: string) => boolean
    updateHover: () => void
    columnEl: Ref<HTMLElement | null>
  }

  return { props, side, store, scope, viewportReads: () => viewportReads }
}

describe("instance I/O column hover", () => {
  it("reveals optional touch targets through the shared gesture hit-test and respects suppression", async () => {
    const { side, props, store, scope } = setupSide()

    const document = Object.assign(new EventTarget(), {
      elementFromPoint: () => ({ closest: () => side.columnEl.value }),
    })

    props.type = "inputs"
    props.side = "left"
    side.columnEl.value = { ownerDocument: document } as unknown as HTMLElement
    await nextTick()
    store.connectionStartHandle.value = { nodeId: "another-node" }

    const move = () => {
      document.dispatchEvent(
        Object.assign(new Event("touchmove"), { touches: [{ clientX: 10, clientY: 20 }] }),
      )
    }

    expect(side.shouldShowHandle("optional")).toBe(false)
    move()
    expect(side.shouldShowHandle("optional")).toBe(true)
    props.preventShowAllHandles = true
    move()
    expect(side.shouldShowHandle("optional")).toBe(false)
    props.preventShowAllHandles = false
    move()
    expect(side.shouldShowHandle("optional")).toBe(true)
    store.connectionStartHandle.value = null
    expect(side.shouldShowHandle("optional")).toBe(false)
    expect(side.shouldShowHandle("required")).toBe(true)

    scope.stop()
  })

  it("reveals unused handles on local entry and preserves connected handles on leave", () => {
    const { side, scope } = setupSide()

    expect(side.shouldShowHandle("used")).toBe(true)
    expect(side.shouldShowHandle("unused")).toBe(false)
    side.updateHover()
    expect(side.shouldShowHandle("unused")).toBe(true)
    side.isHovered.value = false
    expect(side.shouldShowHandle("unused")).toBe(false)
    expect(side.shouldShowHandle("used")).toBe(true)

    scope.stop()
  })

  it("clears stationary hover on pan/zoom and restores it on local pointer movement", () => {
    const { side, store, scope } = setupSide()

    for (const viewport of [
      { x: 10, y: 20, zoom: 1 },
      { x: 10, y: 20, zoom: 0.8 },
    ]) {
      side.updateHover()
      expect(side.showHandlesOnHover.value).toBe(true)
      store.viewport.value = viewport
      expect(side.showHandlesOnHover.value).toBe(false)
      expect(side.shouldShowHandle("used")).toBe(true)
      side.updateHover()
      expect(side.showHandlesOnHover.value).toBe(true)
    }

    scope.stop()
  })

  it("does not restore stale hover after panning, readonly mode, or the low-zoom overlay", () => {
    const { side, props, store, scope } = setupSide()

    side.updateHover()
    store.paneDragging.value = true
    side.updateHover()
    expect(side.showHandlesOnHover.value).toBe(false)
    store.paneDragging.value = false
    expect(side.showHandlesOnHover.value).toBe(false)

    side.updateHover()
    props.preventShowAllHandles = true
    side.updateHover()
    expect(side.showHandlesOnHover.value).toBe(false)
    props.preventShowAllHandles = false
    expect(side.showHandlesOnHover.value).toBe(false)
    side.updateHover()
    expect(side.showHandlesOnHover.value).toBe(true)

    scope.stop()
  })

  it("keeps forced connection handles, required inputs, and connected inputs visible", () => {
    const { side, props, store, scope } = setupSide()

    props.forceShowAllHandles = true
    props.preventShowAllHandles = true
    store.viewport.value = { x: 0, y: 0, zoom: 0.3 }
    expect(side.shouldShowHandle("unused")).toBe(true)

    props.forceShowAllHandles = false
    props.type = "inputs"
    props.side = "left"
    expect(side.shouldShowHandle("required")).toBe(true)
    expect(side.shouldShowHandle("connected")).toBe(true)
    expect(side.shouldShowHandle("optional")).toBe(false)

    scope.stop()
  })

  it("observes the viewport only while hovered and removes its observer on disposal", () => {
    const { side, store, scope, viewportReads } = setupSide()

    expect(viewportReads()).toBe(0)
    store.viewport.value = { x: 1, y: 0, zoom: 1 }
    expect(viewportReads()).toBe(0)
    side.updateHover()
    expect(viewportReads()).toBeGreaterThan(0)
    side.isHovered.value = false
    const readsAfterLeaving = viewportReads()
    store.viewport.value = { x: 2, y: 0, zoom: 1 }
    expect(viewportReads()).toBe(readsAfterLeaving)

    side.updateHover()
    scope.stop()
    const readsAfterDisposal = viewportReads()
    store.viewport.value = { x: 3, y: 0, zoom: 1 }
    expect(viewportReads()).toBe(readsAfterDisposal)
  })
})
