<script setup lang="ts">
import html2canvas from "html2canvas-pro"
import { BlueprintCanvas } from "#layers/core/app/features/canvas"
import { type Blueprint } from "#layers/core/app/features/blueprint/business/shared"
import { PreviewCanvas } from "#layers/core/app/features/canvas"
import {
  getRuntimeInstances,
  resetEvaluation,
  setValidationEnabled,
  type ComponentModel,
  type EntityModel,
} from "@highstate/contract"
import { loadLibrary } from "~/utils/loadLibrary"

type PreviewKind = "snippet" | "blueprint"

type HostRenderMessage = {
  type: "host-render"
  requestId: string
  kind: PreviewKind
  id: string
}

type HostScreenshotMessage = {
  type: "host-screenshot"
  requestId: string
  kind: PreviewKind
  id: string
  width: number
  height: number
}

type HostMessage = HostRenderMessage | HostScreenshotMessage

type HostScreenshotResponse = {
  type: "host-screenshot-result"
  requestId: string
  kind: PreviewKind
  id: string
  dataUrl: string
}

type HostReadyResponse = {
  type: "host-ready"
}

type HostRenderReadyResponse = {
  type: "host-render-ready"
  requestId: string
  kind: PreviewKind
  id: string
}

const containerRef = ref<HTMLElement | null>(null)
const activeKind = ref<PreviewKind>("snippet")
const activeId = ref<string>("")

const activeRenderToken = ref(0)
const canvasReadyToken = ref(0)

const library = await loadLibrary()

setValidationEnabled(false)
resetEvaluation()

const loadSnippet = async (snippetId: string) => {
  resetEvaluation()
  const modules = import.meta.glob("~/snippets/**/*.preview.ts")
  const module = modules[`/snippets/${snippetId.replaceAll("_", "/")}.preview.ts`]

  if (module) {
    await module()
  }

  const instances = getRuntimeInstances()

  const components: Record<string, ComponentModel> = {}
  const entities: Record<string, EntityModel> = {}

  for (const { instance, component } of instances) {
    components[instance.type] = component.model
    for (const entity of component.entities.values()) {
      entities[entity.type] = entity.model
    }
  }

  return { instances, components, entities, found: Boolean(module) }
}

const snippetState = ref<
  | {
      instances: ReturnType<typeof getRuntimeInstances>
      components: Record<string, ComponentModel>
      entities: Record<string, EntityModel>
      found: boolean
    }
  | undefined
>(undefined)

const blueprintState = ref<{ blueprint: Blueprint | null } | undefined>(undefined)

const loadBlueprint = async (blueprintId: string) => {
  const modules = import.meta.glob("~/snippets/**/*.blueprint.json")
  const module = modules[`/snippets/${blueprintId.replaceAll("_", "/")}.blueprint.json`]

  const blueprint = module ? ((await module()) as Blueprint) : null
  return { blueprint }
}

const ensureRendered = async (kind: PreviewKind, id: string) => {
  activeRenderToken.value += 1
  canvasReadyToken.value = 0

  activeKind.value = kind
  activeId.value = id

  await nextTick()

  if (kind === "snippet") {
    snippetState.value = await loadSnippet(id)
    blueprintState.value = undefined
    await nextTick()
    return {
      ready: snippetState.value.found,
    }
  }

  blueprintState.value = await loadBlueprint(id)
  snippetState.value = undefined
  await nextTick()

  return {
    ready: Boolean(blueprintState.value.blueprint),
  }
}

const waitForCanvasReady = async (renderToken: number) => {
  // Wait until the canvas signals that node layout + edge routing is ready.
  await nextTick()

  await new Promise<void>(resolve => {
    const stop = watch(
      canvasReadyToken,
      () => {
        if (activeRenderToken.value !== renderToken) {
          stop()
          resolve()
          return
        }

        if (canvasReadyToken.value > 0) {
          stop()
          resolve()
        }
      },
      { immediate: true },
    )
  })

  // Give the browser a chance to paint after VueFlow updates.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

  await new Promise<void>(resolve => setTimeout(() => resolve(), 2000))
}

const takeScreenshot = async (width: number, height: number) => {
  const element = containerRef.value
  if (!element) {
    return ""
  }

  const previousWidth = element.style.width
  const previousHeight = element.style.height

  element.style.width = `${width}px`
  element.style.height = `${height}px`

  await nextTick()

  const canvas = await html2canvas(element, {
    backgroundColor: "#00000000",
    useCORS: true,
    scale: 1,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
  })

  element.style.width = previousWidth
  element.style.height = previousHeight

  return canvas.toDataURL("image/png")
}

useEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window.parent) {
    return
  }

  const data = event.data as HostMessage
  if (!data?.type) {
    return
  }

  if (data.type === "host-render") {
    const { requestId, kind, id } = data
    const { ready } = await ensureRendered(kind, id)
    const renderToken = activeRenderToken.value

    if (ready) {
      await waitForCanvasReady(renderToken)
    }

    window.parent.postMessage(
      {
        type: "host-render-ready",
        requestId,
        kind,
        id,
        ready,
      } satisfies HostRenderReadyResponse & { ready: boolean },
      "*",
    )

    return
  }

  if (data.type === "host-screenshot") {
    const { requestId, kind, id, width, height } = data
    const { ready } = await ensureRendered(kind, id)
    const renderToken = activeRenderToken.value

    if (ready) {
      await waitForCanvasReady(renderToken)
    }

    const dataUrl = ready ? await takeScreenshot(width, height) : ""

    window.parent.postMessage(
      {
        type: "host-screenshot-result",
        requestId,
        kind,
        id,
        dataUrl,
      } satisfies HostScreenshotResponse,
      "*",
    )
  }
})

onMounted(() => {
  window.parent.postMessage({ type: "host-ready" } satisfies HostReadyResponse, "*")
})
</script>

<template>
  <div ref="containerRef" class="preview-host">
    <PreviewCanvas
      v-if="activeKind === 'snippet' && snippetState?.found"
      :instances="snippetState.instances.map(item => item.instance)"
      :components="snippetState.components"
      :entities="snippetState.entities"
      @ready="canvasReadyToken += 1"
      style="width: 100%; height: 100%"
    />

    <BlueprintCanvas
      v-else-if="activeKind === 'blueprint' && blueprintState?.blueprint"
      :blueprint="blueprintState.blueprint"
      :components="library.components"
      :entities="library.entities"
      @ready="canvasReadyToken += 1"
      style="width: 100%; height: 100%"
    />

    <div v-else class="not-found">Preview is not found.</div>
  </div>
</template>

<style>
@import "vuetify/styles";
@import "../../../../designer/layers/core/app/assets/main.css";

html,
body {
  background: rgb(10, 12, 16);
  color: rgba(255, 255, 255, 0.92);
}

.preview-host {
  width: 100vw;
  height: 100vh;
  background: rgb(10, 12, 16);
}

.not-found {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
}
</style>
