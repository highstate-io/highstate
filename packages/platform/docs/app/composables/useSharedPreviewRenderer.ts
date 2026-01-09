import { useEventListener } from "@vueuse/core"
import { ref } from "vue"

type PreviewKind = "snippet" | "blueprint"

type PreviewTarget = {
  kind: PreviewKind
  id: string
  title?: string
}

type ScreenshotOptions = {
  width: number
  height: number
}

type HostReadyMessage = {
  type: "host-ready"
}

type HostRenderReadyMessage = {
  type: "host-render-ready"
  requestId: string
  kind: PreviewKind
  id: string
  ready: boolean
}

type HostScreenshotResultMessage = {
  type: "host-screenshot-result"
  requestId: string
  kind: PreviewKind
  id: string
  dataUrl: string
}

type HostMessage = HostReadyMessage | HostRenderReadyMessage | HostScreenshotResultMessage

type PendingRequestResolver = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type SharedPreviewRenderer = {
  isHostReady: Readonly<{ value: boolean }>
  isModalOpen: Readonly<{ value: boolean }>
  modalTarget: Readonly<{ value: PreviewTarget | undefined }>

  ensureHost: () => Promise<void>
  setHostFrame: (frame: HTMLIFrameElement | null) => void
  requestThumbnail: (target: PreviewTarget, options: ScreenshotOptions) => Promise<string>
  openInteractive: (target: PreviewTarget) => Promise<void>
  closeInteractive: () => void
}

const HOST_URL = "/preview/host"

const shared_hostFrame = ref<HTMLIFrameElement | null>(null)
const shared_isHostReady = ref(false)
const shared_isModalOpen = ref(false)
const shared_modalTarget = ref<PreviewTarget | undefined>(undefined)
const shared_pendingRequests = ref(
  new Map<string, PendingRequestResolver>(),
)

type DebugEvent = {
  name: string
  at: number
  detail?: unknown
}

const shared_debugEvents = ref<DebugEvent[]>([])

const isDebugEnabled = () => {
  if (typeof window === "undefined") {
    return false
  }

  const enabledInStorage = window.localStorage.getItem("hs.docs.preview.debug") === "1"
  if (enabledInStorage) {
    return true
  }

  const params = new URLSearchParams(window.location.search)
  return params.get("hsPreviewDebug") === "1"
}

const debugLog = (name: string, detail?: unknown) => {
  if (!isDebugEnabled()) {
    return
  }

  const entry: DebugEvent = {
    name,
    at: Date.now(),
    detail,
  }

  shared_debugEvents.value.push(entry)
  if (shared_debugEvents.value.length > 200) {
    shared_debugEvents.value.splice(0, shared_debugEvents.value.length - 200)
  }

  // eslint-disable-next-line no-console
  console.debug(`[hs-docs-preview] ${name}`, detail)
}

const createRequestId = () => {
  return crypto.randomUUID()
}

export const useSharedPreviewHostUrl = () => {
  return HOST_URL
}

export const useSharedPreviewRenderer = (): SharedPreviewRenderer => {
  const hostFrame = shared_hostFrame
  const isHostReady = shared_isHostReady

  const isModalOpen = shared_isModalOpen
  const modalTarget = shared_modalTarget

  const pendingRequests = shared_pendingRequests

  if (typeof window !== "undefined") {
    debugLog("renderer:init")

    useEventListener(window, "message", (event: MessageEvent) => {
      const data = event.data as HostMessage
      if (!data?.type) {
        return
      }

      debugLog("host:message", {
        type: data.type,
        requestId: "requestId" in data ? data.requestId : undefined,
        kind: "kind" in data ? data.kind : undefined,
        id: "id" in data ? data.id : undefined,
      })

      if (data.type === "host-ready") {
        isHostReady.value = true
        debugLog("host:ready")
        return
      }

      if (data.type === "host-render-ready" || data.type === "host-screenshot-result") {
        const resolver = pendingRequests.value.get(data.requestId)
        if (!resolver) {
          debugLog("host:response:no-pending", { requestId: data.requestId, type: data.type })
          return
        }

        pendingRequests.value.delete(data.requestId)
        debugLog("host:response:resolve", { requestId: data.requestId, type: data.type })
        resolver.resolve(data)
      }
    })
  }

  const setHostFrame = (frame: HTMLIFrameElement | null) => {
    hostFrame.value = frame
    debugLog("host:frame:set", {
      present: Boolean(frame),
      src: frame?.src,
    })
  }

  const postToHost = (payload: unknown) => {
    const win = hostFrame.value?.contentWindow
    if (!win) {
      debugLog("host:post:missing-frame", payload)
      throw new Error("Shared preview host iframe is not available")
    }

    debugLog("host:post", payload)
    win.postMessage(payload, "*")
  }

  const requestFromHost = async <TResponse extends HostMessage>(options: {
    requestName: string
    requestId: string
    timeoutMs: number
    timeoutError: Error
    timeoutDebugName: string
    timeoutDebugDetail: unknown
    post: () => void
  }) => {
    const response = await new Promise<TResponse>((resolve, reject) => {
      pendingRequests.value.set(options.requestId, {
        resolve: value => resolve(value as TResponse),
        reject,
      })

      options.post()

      window.setTimeout(() => {
        const resolver = pendingRequests.value.get(options.requestId)
        if (!resolver) {
          return
        }

        pendingRequests.value.delete(options.requestId)
        debugLog(options.timeoutDebugName, options.timeoutDebugDetail)
        reject(options.timeoutError)
      }, options.timeoutMs)
    })

    return response
  }

  const ensureHost = async () => {
    if (isHostReady.value) {
      debugLog("host:ensure:already-ready")
      return
    }

    debugLog("host:ensure:wait")

    await new Promise<void>(resolve => {
      if (typeof window === "undefined") {
        debugLog("host:ensure:server")
        resolve()
        return
      }

      const stop = useEventListener(window, "message", (event: MessageEvent) => {
        const data = event.data as HostMessage
        if (data?.type !== "host-ready") {
          return
        }

        isHostReady.value = true
        debugLog("host:ensure:ready")
        stop()
        resolve()
      })
    })
  }

  const requestThumbnail = async (target: PreviewTarget, options: ScreenshotOptions) => {
    debugLog("thumbnail:request:start", { target, options })
    await ensureHost()

    const requestId = createRequestId()
    debugLog("thumbnail:request:id", { requestId, target })

    const response = await requestFromHost<HostScreenshotResultMessage>({
      requestName: "thumbnail",
      requestId,
      timeoutMs: 15_000,
      timeoutError: new Error("Shared preview screenshot timed out"),
      timeoutDebugName: "thumbnail:timeout",
      timeoutDebugDetail: { requestId, target },
      post: () => {
        debugLog("thumbnail:request:post", { requestId, target, options })

        postToHost({
          type: "host-screenshot",
          requestId,
          kind: target.kind,
          id: target.id,
          width: options.width,
          height: options.height,
        })
      },
    })

    debugLog("thumbnail:request:done", {
      requestId,
      target,
      dataUrlLength: response.dataUrl.length,
    })
    return response.dataUrl
  }

  const openInteractive = async (target: PreviewTarget) => {
    debugLog("interactive:open:start", { target })
    modalTarget.value = target
    isModalOpen.value = true

    debugLog("interactive:modal:open", { target })

    await ensureHost()

    const requestId = createRequestId()
    debugLog("interactive:render:id", { requestId, target })

    const response = await requestFromHost<HostRenderReadyMessage>({
      requestName: "interactive",
      requestId,
      timeoutMs: 15_000,
      timeoutError: new Error("Shared preview render timed out"),
      timeoutDebugName: "interactive:timeout",
      timeoutDebugDetail: { requestId, target },
      post: () => {
        debugLog("interactive:render:post", { requestId, target })

        postToHost({
          type: "host-render",
          requestId,
          kind: target.kind,
          id: target.id,
        })
      },
    })

    if (!response.ready) {
      debugLog("interactive:render:not-found", { requestId, target })
      throw new Error(`Preview not found: ${target.kind}:${target.id}`)
    }

    debugLog("interactive:open:done", { requestId, target })
  }

  const closeInteractive = () => {
    debugLog("interactive:close", { previousTarget: modalTarget.value })
    isModalOpen.value = false
  }

  return {
    isHostReady,
    isModalOpen,
    modalTarget,

    ensureHost,
    setHostFrame,
    requestThumbnail,
    openInteractive,
    closeInteractive,
  }
}
