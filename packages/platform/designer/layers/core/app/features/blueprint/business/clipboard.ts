import type { HubModel, InstanceModel } from "@highstate/contract"
import type { VueFlowStore } from "@vue-flow/core"
import type { CanvasSelection, CursorMode } from "#layers/core/app/features/canvas"
import { createBlueprint, parseBlueprint, serializeBlueprint, type Blueprint } from "./shared"
import { clone } from "remeda"

export function useBlueprintClipboard(
  vueFlowStore: VueFlowStore,
  cursorMode: Ref<CursorMode>,
  blueprint: Ref<Blueprint | undefined>,
  seleciton: CanvasSelection,
  target: MaybeRef<EventTarget | null>,
) {
  const localClipboard = ref<Blueprint | undefined>(undefined)
  const { copy, copied } = useClipboard()
  const { ctrl_c } = useMagicKeys({ target: target as Ref<EventTarget> })

  watch(ctrl_c, pressed => {
    if (!pressed) {
      return
    }

    if (!seleciton.selectedNodeIds.size) {
      // nothing to copy
      return
    }

    const nodes = Array.from(seleciton.selectedNodeIds.values())
      .map(id => vueFlowStore.findNode(id))
      .filter(node => node !== undefined)

    const instances: InstanceModel[] = []
    const hubs: HubModel[] = []

    for (const node of nodes) {
      if (node.data.instance) {
        instances.push(node.data.instance)
      } else if (node.data.hub) {
        hubs.push(node.data.hub)
      }
    }

    const blueprintValue = createBlueprint(nodes, instances, hubs)
    const serialized = serializeBlueprint(blueprintValue)

    // clear the selection and reset cursor mode
    cursorMode.value = "default"
    seleciton.clearSelection()

    globalLogger.debug({ blueprint: blueprintValue }, "copying blueprint to clipboard")

    localClipboard.value = blueprintValue
    void copy(serialized)

    // factorio-like behavior: start pasting immediately after copying
    blueprint.value = clone(blueprintValue)
  })

  useEventListener(window, "paste", async () => {
    let globalContent: string | undefined
    let blueprintValue: Blueprint | null | undefined

    try {
      globalContent = await navigator.clipboard.readText()
    } catch (error) {
      globalLogger.error({ error }, "failed to read clipboard content")
    }

    if (globalContent) {
      blueprintValue = parseBlueprint(globalContent)
    }

    if (!blueprintValue) {
      // if no valid blueprint was found in the clipboard, use the local clipboard
      blueprintValue = localClipboard.value
    }

    if (!blueprintValue) {
      // TODO: indicate the error in the UI
      return
    }

    globalLogger.debug({ blueprint: blueprintValue }, "pasting blueprint from clipboard")
    blueprint.value = clone(blueprintValue)
  })

  return {
    copied,
  }
}
